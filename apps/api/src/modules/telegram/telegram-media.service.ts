import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

@Injectable()
export class TelegramMediaService {
  private readonly logger = new Logger(TelegramMediaService.name);

  constructor(private settings: SettingsService) {}

  /** Get Gemini API key from settings or env */
  private async getGeminiKey(): Promise<string> {
    const key = (await this.settings.get('llm_key_google')) || process.env.GEMINI_API_KEY;
    if (!key) throw new Error('Gemini API key not configured (set llm_key_google in Settings or GEMINI_API_KEY env)');
    return key;
  }

  /** Transcribe audio using Gemini Flash */
  async transcribeAudio(audioBuffer: Buffer, mimeType = 'audio/ogg'): Promise<string> {
    const apiKey = await this.getGeminiKey();
    const audioB64 = audioBuffer.toString('base64');

    const payload = {
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: audioB64 } },
          { text: 'Transcribe this voice message exactly as spoken. Return ONLY the transcription, nothing else. Keep the original language.' },
        ],
      }],
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    const result = await res.json();

    try {
      return result.candidates[0].content.parts[0].text;
    } catch {
      this.logger.error('Gemini transcription failed:', result);
      throw new Error(`Transcription failed: ${JSON.stringify(result.error || result)}`);
    }
  }

  /** Convert text to OGG voice using Gemini TTS + ffmpeg */
  async textToVoice(text: string, voice = 'Kore'): Promise<Buffer> {
    const apiKey = await this.getGeminiKey();

    // Clean markdown for natural speech
    const cleanText = text
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/`/g, '')
      .replace(/#/g, '')
      .slice(0, 2000);

    const payload = {
      contents: [{ parts: [{ text: cleanText }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });

    const result = await res.json();

    let audioB64: string | null = null;
    try {
      for (const part of result.candidates[0].content.parts) {
        if (part.inlineData) {
          audioB64 = part.inlineData.data;
          break;
        }
      }
      if (!audioB64) throw new Error('No audio in response');
    } catch (e) {
      throw new Error(`Gemini TTS failed: ${result.error || e}`);
    }

    // PCM → OGG Opus via ffmpeg
    const id = randomUUID().slice(0, 8);
    const pcmPath = join(tmpdir(), `tts-${id}.pcm`);
    const oggPath = join(tmpdir(), `tts-${id}.ogg`);

    try {
      writeFileSync(pcmPath, Buffer.from(audioB64, 'base64'));
      execSync(
        `ffmpeg -y -f s16le -ar 24000 -ac 1 -i "${pcmPath}" -c:a libopus -b:a 48k "${oggPath}"`,
        { timeout: 10000, stdio: 'pipe' },
      );
      return readFileSync(oggPath);
    } finally {
      try { unlinkSync(pcmPath); } catch {}
      try { unlinkSync(oggPath); } catch {}
    }
  }

  /** Split long message into Telegram-compatible chunks (4096 chars) */
  splitMessage(text: string, maxLength = 4096): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      let splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt === -1 || splitAt < maxLength / 2) {
        splitAt = remaining.lastIndexOf(' ', maxLength);
      }
      if (splitAt === -1) splitAt = maxLength;

      let chunk = remaining.slice(0, splitAt);
      remaining = remaining.slice(splitAt).trimStart();

      // Handle unclosed code blocks
      if ((chunk.match(/```/g) || []).length % 2 === 1) {
        chunk += '\n```';
        remaining = '```\n' + remaining;
      }

      chunks.push(chunk);
    }

    return chunks;
  }

  /** Voice markers for detecting voice response requests (multilingual) */
  private static VOICE_MARKERS = [
    'voice reply', 'reply with voice', 'respond with audio',
    'send voice', 'send audio', 'audio reply', 'voice message',
    'reply by voice', 'answer with voice', 'record audio',
    'ответь голосом', 'голосовое', 'голосом ответь', 'запиши аудио',
    'ответь аудио', 'скажи голосом', 'аудио ответ', 'voice',
  ];

  /** Check if user requested a voice response */
  wantsVoiceResponse(text: string): boolean {
    const lower = text.toLowerCase();
    return TelegramMediaService.VOICE_MARKERS.some((m) => lower.includes(m));
  }
}
