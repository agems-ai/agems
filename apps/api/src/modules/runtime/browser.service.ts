import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import * as http from 'http';

/**
 * BrowserService connects to the Playwright MCP container's shared Chromium via CDP.
 * Instead of launching its own browser, it attaches to the CDP endpoint exposed by
 * the playwright-mcp Docker service (port 9222) and streams screencast frames.
 */

const CDP_HOST = process.env.PLAYWRIGHT_CDP_HOST || 'playwright-mcp';
const CDP_PORT = parseInt(process.env.PLAYWRIGHT_CDP_PORT || '9223', 10);

const MAX_SCREENSHOT_FRAMES = 3;

interface BrowserSession {
  id: string;
  executionId: string;
  agentId: string;
  channelId?: string;
  ws?: any;
  streaming: boolean;
  frameCount: number;
  /** Ring buffer of last N frames (base64 JPEG) for screenshots on execution end */
  recentFrames: string[];
}

@Injectable()
export class BrowserService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserService.name);
  private readonly sessions = new Map<string, BrowserSession>();

  constructor(private readonly events: EventEmitter2) {}

  onModuleDestroy() {
    for (const [execId] of this.sessions) {
      this.stopSession(execId);
    }
  }

  /** Start a browser session — connects to Playwright MCP's shared Chromium CDP */
  async startSession(
    executionId: string,
    agentId: string,
    channelId?: string,
  ): Promise<{ cdpPort: number; cdpWsUrl: string } | null> {
    if (this.sessions.has(executionId)) {
      return { cdpPort: CDP_PORT, cdpWsUrl: '' };
    }

    const session: BrowserSession = {
      id: randomUUID(),
      executionId,
      agentId,
      channelId,
      streaming: false,
      frameCount: 0,
      recentFrames: [],
    };
    this.sessions.set(executionId, session);

    // Connect to the shared Chromium in playwright-mcp container
    const connected = await this.connectToPlaywrightCdp(session);
    if (!connected) {
      this.logger.warn(`Could not connect to Playwright CDP at ${CDP_HOST}:${CDP_PORT} — browser streaming unavailable`);
      this.sessions.delete(executionId);
      return null;
    }

    this.logger.log(`Connected to Playwright CDP for execution ${executionId}`);
    return { cdpPort: CDP_PORT, cdpWsUrl: `ws://${CDP_HOST}:${CDP_PORT}` };
  }

  /** Connect to Playwright MCP's Chromium and start screencast */
  private async connectToPlaywrightCdp(session: BrowserSession): Promise<boolean> {
    // Wait for CDP to be reachable
    const targets = await this.waitForTargets(15_000);
    if (!targets || targets.length === 0) {
      this.logger.error('No CDP targets found in Playwright MCP container');
      return false;
    }

    // Find a page target (Playwright creates pages when navigating)
    const pageTarget = targets.find((t: any) => t.type === 'page');
    if (!pageTarget?.webSocketDebuggerUrl) {
      this.logger.warn('No page target with CDP WebSocket URL found');
      return false;
    }

    // Replace both host and port — CDP returns 127.0.0.1:9222 but we connect via proxy on 9223
    const wsUrl = pageTarget.webSocketDebuggerUrl
      .replace('127.0.0.1', CDP_HOST)
      .replace('localhost', CDP_HOST)
      .replace(':9222/', `:${CDP_PORT}/`);
    this.logger.log(`Connecting to CDP page: ${wsUrl}`);

    try {
      // @ts-ignore - ws has no type declarations in this project
      const WebSocket = (await import('ws')).default;
      const ws = new WebSocket(wsUrl);
      session.ws = ws;

      let msgId = 1;

      ws.on('open', () => {
        // Enable page events
        ws.send(JSON.stringify({ id: msgId++, method: 'Page.enable', params: {} }));

        // Start screencast
        ws.send(JSON.stringify({
          id: msgId++,
          method: 'Page.startScreencast',
          params: {
            format: 'jpeg',
            quality: 50,
            maxWidth: 1280,
            maxHeight: 800,
            everyNthFrame: 1,
          },
        }));

        session.streaming = true;
        this.logger.log(`Screencast started for execution ${session.executionId}`);
      });

      ws.on('message', (rawData: Buffer) => {
        try {
          const msg = JSON.parse(rawData.toString());

          if (msg.method === 'Page.screencastFrame') {
            const { data: frameData, metadata, sessionId } = msg.params;
            session.frameCount++;

            // Store in ring buffer for screenshots
            session.recentFrames.push(frameData);
            if (session.recentFrames.length > MAX_SCREENSHOT_FRAMES) {
              session.recentFrames.shift();
            }

            if (session.frameCount <= 3 || session.frameCount % 10 === 0) {
              this.logger.log(`Frame #${session.frameCount} for ${session.executionId} (${(frameData?.length / 1024).toFixed(1)}KB)`);
            }

            // Emit frame for dashboard
            this.events.emit('agent.browser.frame', {
              executionId: session.executionId,
              agentId: session.agentId,
              channelId: session.channelId,
              frame: frameData,
              metadata: {
                pageScaleFactor: metadata?.pageScaleFactor,
                deviceWidth: metadata?.deviceWidth,
                deviceHeight: metadata?.deviceHeight,
                timestamp: metadata?.timestamp,
              },
            });

            // Acknowledge frame
            ws.send(JSON.stringify({
              id: msgId++,
              method: 'Page.screencastFrameAck',
              params: { sessionId },
            }));
          }

          // When Playwright navigates, we get frame events — good for live preview
          if (msg.method === 'Page.frameNavigated') {
            this.logger.log(`Page navigated: ${msg.params?.frame?.url || 'unknown'}`);
          }
        } catch {}
      });

      ws.on('close', () => {
        session.streaming = false;
        this.logger.log(`CDP WebSocket closed for ${session.executionId}`);
      });

      ws.on('error', (err: Error) => {
        this.logger.warn(`CDP WebSocket error: ${err.message}`);
        session.streaming = false;
      });

      return true;
    } catch (err: any) {
      this.logger.error(`Failed to connect to CDP: ${err.message}`);
      return false;
    }
  }

  /** Wait for CDP targets to be available */
  private waitForTargets(timeoutMs: number): Promise<any[] | null> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (Date.now() - start > timeoutMs) return resolve(null);
        const req = http.get(`http://${CDP_HOST}:${CDP_PORT}/json/list`, (res) => {
          let data = '';
          res.on('data', (d) => (data += d));
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (Array.isArray(json) && json.length > 0) {
                resolve(json);
              } else {
                setTimeout(check, 500);
              }
            } catch {
              setTimeout(check, 500);
            }
          });
        });
        req.on('error', () => setTimeout(check, 500));
        req.setTimeout(2000, () => { req.destroy(); setTimeout(check, 500); });
      };
      check();
    });
  }

  /** Stop a browser session. Returns up to 3 recent screenshots (base64 JPEG). */
  stopSession(executionId: string): string[] {
    const session = this.sessions.get(executionId);
    if (!session) return [];

    const screenshots = [...session.recentFrames];

    // Emit stop event so frontend cleans up
    this.events.emit('agent.browser.stop', {
      executionId: session.executionId,
      agentId: session.agentId,
      channelId: session.channelId,
    });

    // Close WebSocket (but don't kill browser — it's shared)
    if (session.ws) {
      try {
        session.ws.send(JSON.stringify({ id: 9999, method: 'Page.stopScreencast', params: {} }));
        session.ws.close();
      } catch {}
    }

    this.sessions.delete(executionId);
    this.logger.log(`Browser session stopped for execution ${executionId} (${session.frameCount} frames, ${screenshots.length} screenshots)`);
    return screenshots;
  }

  /** Check if an execution has an active browser session */
  hasSession(executionId: string): boolean {
    return this.sessions.has(executionId);
  }

  /** Get active session info */
  getActiveSessions(): Array<{ executionId: string; agentId: string; streaming: boolean; frameCount: number }> {
    return Array.from(this.sessions.values()).map(s => ({
      executionId: s.executionId,
      agentId: s.agentId,
      streaming: s.streaming,
      frameCount: s.frameCount,
    }));
  }
}
