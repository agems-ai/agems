/**
 * Import top 100 skills from ClawdHub.ai into AGEMS Catalog
 *
 * Usage: npx tsx scripts/import-clawhub-skills.ts
 *
 * Requires DATABASE_URL environment variable
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const skills = [
  { name: "Self-Improving Agent", slug: "self-improving-agent", description: "Captures learnings, errors, and corrections to enable continuous improvement. Logs command failures and user corrections for self-reflection and self-learning.", downloads: 208475, version: "3.0.2", tags: ["learning", "self-improvement", "ai-agent", "memory"] },
  { name: "Find Skills", slug: "find-skills", description: "Helps users discover and install agent skills for new functionality. Search for capabilities by category, keyword, or use case.", downloads: 202786, version: "0.1.0", tags: ["discovery", "skills", "search", "package-management"] },
  { name: "Summarize", slug: "summarize", description: "Summarize URLs or files with the summarize CLI — supports web pages, PDFs, images, audio, and YouTube videos.", downloads: 154450, version: "1.0.0", tags: ["summarization", "content", "pdf", "youtube", "audio"] },
  { name: "Agent Browser", slug: "agent-browser", description: "Fast Rust-based headless browser automation CLI with Node.js fallback. Navigate, click, fill forms, and extract data from web pages.", downloads: 125918, version: "0.2.0", tags: ["automation", "browser", "headless", "web-scraping"] },
  { name: "Google Workspace (Gog)", slug: "gog", description: "Google Workspace CLI for Gmail, Calendar, Drive, Contacts, Sheets, and Docs. Full integration with Google services.", downloads: 111670, version: "1.0.0", tags: ["google", "workspace", "gmail", "calendar", "drive", "sheets"] },
  { name: "GitHub", slug: "github", description: "Interact with GitHub using the gh CLI for issues, PRs, CI runs, and queries. Manage repositories, review code, and automate workflows.", downloads: 107253, version: "1.0.0", tags: ["github", "development", "git", "ci-cd"] },
  { name: "Ontology", slug: "ontology", description: "Typed knowledge graph for structured agent memory and composable skills. Build and query semantic relationships between entities.", downloads: 102842, version: "1.0.4", tags: ["knowledge-graph", "memory", "semantic", "data-modeling"] },
  { name: "Proactive Agent", slug: "proactive-agent", description: "Transform AI agents into proactive partners with WAL Protocol and autonomous crons. Agents initiate actions based on context and schedules.", downloads: 97197, version: "3.1.0", tags: ["proactive", "agent", "autonomous", "scheduling"] },
  { name: "Skill Vetter", slug: "skill-vetter", description: "Security-first skill vetting for AI agents with permission scope checking. Analyze skills for security risks before installation.", downloads: 92010, version: "1.0.0", tags: ["security", "vetting", "permissions", "audit"] },
  { name: "Weather", slug: "weather", description: "Get current weather and forecasts for any location worldwide. No API key required — uses free weather services.", downloads: 91973, version: "1.0.0", tags: ["weather", "forecast", "utility"] },
  { name: "Self-Improving + Proactive Agent", slug: "self-improving", description: "Self-reflection, self-criticism, self-learning, and self-organizing memory. Combines self-improvement with proactive behavior patterns.", downloads: 65746, version: "1.2.16", tags: ["self-improving", "proactive", "memory", "ai-agent"] },
  { name: "Sonos CLI", slug: "sonoscli", description: "Control Sonos speakers — discover, check status, play music, adjust volume, and manage speaker groups.", downloads: 57394, version: "1.0.0", tags: ["sonos", "audio", "smart-home", "music"] },
  { name: "Nano PDF", slug: "nano-pdf", description: "Edit PDFs with natural-language instructions using the nano-pdf CLI. Merge, split, extract, and modify PDF documents.", downloads: 56927, version: "1.0.0", tags: ["pdf", "editing", "documents"] },
  { name: "Notion", slug: "notion", description: "Notion API for creating and managing pages, databases, and blocks. Full CRUD operations on Notion workspace content.", downloads: 54099, version: "1.0.0", tags: ["notion", "database", "productivity", "wiki"] },
  { name: "Humanizer", slug: "humanizer", description: "Remove signs of AI-generated writing from text based on Wikipedia guidelines. Make AI content sound natural and human-written.", downloads: 53686, version: "1.0.0", tags: ["writing", "humanization", "content", "text-processing"] },
  { name: "Multi Search Engine", slug: "multi-search-engine", description: "Multi search engine integration with 17 engines — 8 Chinese (Baidu, Sogou, etc.) and 9 Global (Google, Bing, etc.).", downloads: 50546, version: "2.0.1", tags: ["search", "multi-engine", "web", "research"] },
  { name: "Obsidian", slug: "obsidian", description: "Work with Obsidian vaults (plain Markdown notes) and automate via obsidian-cli. Create, search, link, and manage notes.", downloads: 49811, version: "1.0.0", tags: ["obsidian", "notes", "markdown", "knowledge-management"] },
  { name: "Nano Banana Pro", slug: "nano-banana-pro", description: "Generate and edit images with Nano Banana Pro (Gemini 3 Pro Image). AI-powered image creation from text prompts.", downloads: 48654, version: "1.0.1", tags: ["image-generation", "gemini", "ai-art", "creative"] },
  { name: "OpenAI Whisper", slug: "openai-whisper", description: "Local speech-to-text transcription with the Whisper CLI. No API key required — runs entirely on local hardware.", downloads: 45009, version: "1.0.0", tags: ["speech", "transcription", "whisper", "audio", "stt"] },
  { name: "Auto-Updater", slug: "auto-updater", description: "Automatically update all installed skills once daily via cron. Keep agent capabilities current with zero manual intervention.", downloads: 43183, version: "1.0.0", tags: ["auto-update", "maintenance", "cron", "package-management"] },
  { name: "API Gateway", slug: "api-gateway", description: "Connect to 100+ APIs with managed OAuth — Google, Microsoft, GitHub, Notion, Slack, and more. Unified authentication layer.", downloads: 42649, version: "1.0.69", tags: ["api", "integration", "oauth", "gateway"] },
  { name: "Skill Creator", slug: "skill-creator", description: "Guide for creating effective skills that extend AI agent capabilities. Templates, best practices, and publishing workflow.", downloads: 39657, version: "0.1.0", tags: ["skill-development", "authoring", "templates"] },
  { name: "AdClaw", slug: "adclaw", description: "Ad creative search assistant for discovering and analyzing advertising creatives across platforms and markets.", downloads: 39588, version: "1.0.10", tags: ["advertising", "creative", "marketing", "research"] },
  { name: "Baidu Search", slug: "baidu-search", description: "Search the web using Baidu AI Search Engine (BDSE). Optimized for Chinese-language content and research.", downloads: 39147, version: "1.1.2", tags: ["search", "baidu", "chinese", "web"] },
  { name: "Brave Search", slug: "brave-search", description: "Web search and content extraction via Brave Search API. Privacy-focused search with structured results.", downloads: 38769, version: "1.0.1", tags: ["search", "web", "brave", "privacy"] },
  { name: "Automation Workflows", slug: "automation-workflows", description: "Design and implement automation workflows to save time and scale operations. Workflow patterns for common business processes.", downloads: 38483, version: "0.1.0", tags: ["automation", "workflow", "business-process", "productivity"] },
  { name: "MCPorter", slug: "mcporter", description: "Use mcporter CLI to list, configure, authenticate, and call MCP servers and tools. Unified MCP management.", downloads: 36146, version: "1.0.0", tags: ["mcp", "tools", "integration", "protocol"] },
  { name: "Free Ride - Unlimited Free AI", slug: "free-ride", description: "Manages free AI models from OpenRouter with automatic ranking. Access multiple AI models without API costs.", downloads: 35364, version: "1.0.4", tags: ["ai-models", "free", "openrouter", "llm"] },
  { name: "YouTube Transcript", slug: "openclaw-youtube-transcript", description: "Transcribe YouTube videos to text by extracting captions and subtitles. Supports multiple languages.", downloads: 31670, version: "1.0.1", tags: ["youtube", "transcription", "captions", "video"] },
  { name: "Outlook Graph", slug: "outlook-graph", description: "Connect to Outlook and Microsoft Graph for email and calendar management. Read, send, and organize emails.", downloads: 30592, version: "1.0.2", tags: ["outlook", "microsoft", "email", "calendar"] },
  { name: "Elite Long-term Memory", slug: "elite-longterm-memory", description: "Ultimate AI agent memory system with WAL protocol and vector search. Persistent context across conversations.", downloads: 30157, version: "1.2.3", tags: ["memory", "longterm", "vector-search", "persistence"] },
  { name: "Stock Analysis", slug: "stock-analysis", description: "Analyze stocks and cryptocurrencies using Yahoo Finance data. Charts, technical indicators, and market insights.", downloads: 30060, version: "6.2.0", tags: ["stocks", "finance", "crypto", "analysis", "trading"] },
  { name: "Humanize AI Text", slug: "humanize-ai-text", description: "Humanize AI-generated text to make it sound natural. Advanced rewriting techniques for authentic content.", downloads: 29968, version: "1.0.1", tags: ["writing", "humanization", "content", "rewriting"] },
  { name: "YouTube Watcher", slug: "youtube-watcher", description: "Fetch and read transcripts from YouTube videos. Extract key information and summaries from video content.", downloads: 29625, version: "1.0.0", tags: ["youtube", "transcription", "video", "content"] },
  { name: "ByteRover", slug: "byterover", description: "Knowledge management for AI agents with pattern storage and retrieval. Build reusable knowledge bases.", downloads: 28911, version: "2.0.0", tags: ["knowledge-management", "patterns", "retrieval", "ai-agent"] },
  { name: "Documentation Expert", slug: "clawddocs", description: "Documentation expert with decision tree navigation and search. Navigate complex documentation efficiently.", downloads: 28329, version: "1.2.2", tags: ["documentation", "search", "navigation", "reference"] },
  { name: "Desktop Control", slug: "desktop-control", description: "Advanced desktop automation with mouse, keyboard, and screen control. Automate any desktop application.", downloads: 27970, version: "1.0.0", tags: ["automation", "desktop", "mouse", "keyboard", "screen"] },
  { name: "Himalaya Email", slug: "himalaya", description: "CLI to manage emails via IMAP/SMTP with multi-account support. Read, send, and organize emails from terminal.", downloads: 27234, version: "1.0.0", tags: ["email", "imap", "smtp", "cli"] },
  { name: "Slack", slug: "slack", description: "Control Slack for messages, reactions, channels, and threads. Send notifications and automate Slack workflows.", downloads: 26623, version: "1.0.0", tags: ["slack", "messaging", "chat", "notifications"] },
  { name: "Tavily Search", slug: "openclaw-tavily-search", description: "Web search via Tavily API — AI-optimized search results for research and fact-checking.", downloads: 26385, version: "0.1.0", tags: ["search", "tavily", "ai", "research"] },
  { name: "Video Frames", slug: "video-frames", description: "Extract frames or short clips from videos using ffmpeg. Capture screenshots, create thumbnails, and trim videos.", downloads: 26326, version: "1.0.0", tags: ["video", "ffmpeg", "frames", "media"] },
  { name: "Browser Use", slug: "browser-use", description: "Automates browser interactions for web testing, form filling, and data extraction. Headless browser automation.", downloads: 25028, version: "1.0.2", tags: ["browser", "automation", "testing", "web-scraping"] },
  { name: "Trello", slug: "trello", description: "Manage Trello boards, lists, and cards via the Trello REST API. Organize projects and track tasks.", downloads: 24805, version: "1.0.0", tags: ["trello", "productivity", "project-management", "kanban"] },
  { name: "Blog Watcher", slug: "blogwatcher", description: "Monitor blogs and RSS/Atom feeds for updates using the blogwatcher CLI. Stay informed about content changes.", downloads: 24443, version: "1.0.0", tags: ["rss", "monitoring", "blogs", "feeds"] },
  { name: "Model Usage", slug: "model-usage", description: "Summarize per-model usage for AI tools. Track token consumption, costs, and model performance metrics.", downloads: 24149, version: "1.0.0", tags: ["usage", "analytics", "tokens", "costs"] },
  { name: "Gmail", slug: "gmail", description: "Gmail API integration with managed OAuth for email management. Read, send, label, and search emails.", downloads: 23661, version: "1.0.6", tags: ["gmail", "email", "google", "oauth"] },
  { name: "News Summary", slug: "news-summary", description: "Fetch news from trusted international RSS feeds with voice summaries. Stay updated on global events.", downloads: 23605, version: "1.0.1", tags: ["news", "rss", "summary", "media"] },
  { name: "IMAP/SMTP Email", slug: "imap-smtp-email", description: "Read and send email via IMAP/SMTP with attachment support. Universal email access for any provider.", downloads: 23299, version: "0.0.9", tags: ["email", "imap", "smtp", "attachments"] },
  { name: "YouTube API", slug: "youtube-api-skill", description: "YouTube Data API integration with managed OAuth for video and playlist management. Upload, search, and analyze.", downloads: 22200, version: "1.0.3", tags: ["youtube", "api", "video", "oauth"] },
  { name: "Evolver", slug: "evolver", description: "A self-evolution engine for AI agents with protocol-constrained evolution. Agents improve their own capabilities.", downloads: 21738, version: "1.29.8", tags: ["evolution", "self-improvement", "ai-agent", "autonomous"] },
  { name: "Playwright MCP", slug: "playwright-mcp", description: "Browser automation via Playwright MCP server for web workflows. Test, scrape, and automate web applications.", downloads: 21718, version: "1.0.0", tags: ["browser", "playwright", "mcp", "testing", "automation"] },
  { name: "Markdown Converter", slug: "markdown-converter", description: "Convert documents and files to Markdown using markitdown. Supports PDF, DOCX, HTML, and more.", downloads: 21511, version: "1.0.0", tags: ["markdown", "conversion", "documents", "pdf"] },
  { name: "Gemini", slug: "gemini", description: "Gemini CLI for one-shot Q&A, summaries, and generation. Access Google's Gemini AI models directly.", downloads: 21427, version: "1.0.0", tags: ["gemini", "ai", "google", "llm"] },
  { name: "Agent Browser (ClawdBot)", slug: "agent-browser-clawdbot", description: "Headless browser automation CLI optimized for AI agents with accessibility trees. Smart element selection.", downloads: 21413, version: "0.1.0", tags: ["browser", "automation", "accessibility", "ai-agent"] },
  { name: "Browser Automation", slug: "browser-automation", description: "Automate web browser interactions using natural language via CLI. Describe what you want, the browser does it.", downloads: 20775, version: "1.0.1", tags: ["browser", "automation", "natural-language", "web"] },
  { name: "Tavily AI Search", slug: "tavily", description: "AI-optimized web search using Tavily Search API for research. Get structured, relevant results fast.", downloads: 20392, version: "1.0.0", tags: ["search", "ai", "tavily", "research"] },
  { name: "QMD Search", slug: "qmd", description: "Local search and indexing CLI with BM25, vectors, and rerank. MCP mode for agent integration.", downloads: 20197, version: "1.0.0", tags: ["search", "indexing", "bm25", "vectors", "local"] },
  { name: "Apple Notes", slug: "apple-notes", description: "Manage Apple Notes via the memo CLI on macOS. Create, view, edit, and delete notes from terminal.", downloads: 19897, version: "1.0.0", tags: ["apple", "notes", "macos", "productivity"] },
  { name: "Stock Market Pro", slug: "stock-market-pro", description: "Yahoo Finance powered stock analysis with charts and technical indicators. Advanced trading insights.", downloads: 19868, version: "1.2.12", tags: ["stocks", "finance", "charts", "trading", "yahoo-finance"] },
  { name: "SuperDesign", slug: "superdesign", description: "Expert frontend design guidelines for creating beautiful, modern UIs. Design systems, components, and patterns.", downloads: 19713, version: "1.0.0", tags: ["design", "frontend", "ui", "ux", "css"] },
  { name: "LNBits Wallet", slug: "lnbits-with-qrcode", description: "Manage LNbits Lightning Wallet — check balance, make payments, create invoices with QR codes.", downloads: 19710, version: "1.0.2", tags: ["bitcoin", "wallet", "lightning", "payments", "crypto"] },
  { name: "Discord", slug: "discord", description: "Control Discord for messages, reactions, and moderation. Send notifications and manage server channels.", downloads: 19459, version: "1.0.1", tags: ["discord", "messaging", "chat", "moderation"] },
  { name: "Web Search by Exa", slug: "web-search-exa", description: "Neural web search and content extraction via Exa MCP server. Semantic search for better results.", downloads: 19220, version: "2.0.0", tags: ["search", "exa", "neural", "semantic", "mcp"] },
  { name: "CalDAV Calendar", slug: "caldav-calendar", description: "Sync and query CalDAV calendars — iCloud, Google, Fastmail, Nextcloud. Manage events and scheduling.", downloads: 18907, version: "1.0.1", tags: ["calendar", "caldav", "scheduling", "icloud", "google"] },
  { name: "Outlook", slug: "outlook-api", description: "Microsoft Outlook API integration with managed OAuth for email and calendar. Full Microsoft 365 access.", downloads: 18890, version: "1.0.3", tags: ["outlook", "microsoft", "email", "calendar", "oauth"] },
  { name: "Docker Essentials", slug: "docker-essentials", description: "Essential Docker commands and workflows for container management. Build, run, and manage containers.", downloads: 18825, version: "1.0.0", tags: ["docker", "containers", "devops", "deployment"] },
  { name: "ClawdHub CLI", slug: "clawdhub", description: "Use ClawdHub CLI to search, install, update, and publish agent skills. Package management for AI agents.", downloads: 18548, version: "1.0.0", tags: ["skills", "package-management", "cli", "marketplace"] },
  { name: "PDF Toolkit", slug: "pdf", description: "Comprehensive PDF manipulation toolkit for extraction and creation. Read, merge, split, and create PDFs.", downloads: 18522, version: "0.1.0", tags: ["pdf", "documents", "extraction", "creation"] },
  { name: "Feishu Evolver", slug: "feishu-evolver-wrapper", description: "Feishu-integrated wrapper for the capability-evolver with rich card reports. Enterprise evolution tracking.", downloads: 18493, version: "1.7.1", tags: ["feishu", "evolution", "enterprise", "reporting"] },
  { name: "WhatsApp Business", slug: "whatsapp-business", description: "WhatsApp Business API integration with managed OAuth for messaging. Send templates, media, and interactive messages.", downloads: 18360, version: "1.0.3", tags: ["whatsapp", "messaging", "business", "api"] },
  { name: "Stripe", slug: "stripe-api", description: "Stripe API integration with managed OAuth for payments and subscriptions. Manage customers, invoices, and products.", downloads: 18211, version: "1.0.8", tags: ["stripe", "payments", "subscriptions", "billing"] },
  { name: "Web Search (DuckDuckGo)", slug: "web-search", description: "Web search using DuckDuckGo's API for research and fact-checking. Privacy-respecting search results.", downloads: 17814, version: "1.0.0", tags: ["search", "web", "duckduckgo", "privacy"] },
  { name: "Memory Setup", slug: "memory-setup", description: "Enable and configure persistent agent memory with vector search. Long-term context retention across sessions.", downloads: 17764, version: "1.0.0", tags: ["memory", "setup", "persistence", "vector-search"] },
  { name: "Session Logs", slug: "session-logs", description: "Search and analyze your own session logs and older conversations. Review past interactions and decisions.", downloads: 17639, version: "1.0.0", tags: ["logs", "analysis", "history", "sessions"] },
  { name: "AgentMail", slug: "agentmail", description: "API-first email platform designed for AI agents with webhooks. Send and receive emails programmatically.", downloads: 17626, version: "1.1.1", tags: ["email", "agents", "api", "webhooks"] },
  { name: "Capability Evolver", slug: "capability-evolver", description: "A self-evolution engine for AI agents with protocol-constrained evolution. Systematic capability improvement.", downloads: 17548, version: "1.29.8", tags: ["evolution", "capability", "ai-agent", "protocol"] },
  { name: "DuckDuckGo Search", slug: "duckduckgo-search", description: "Real-time web, news, image, and video searches via DuckDuckGo. Multi-modal search capabilities.", downloads: 17203, version: "1.0.0", tags: ["search", "duckduckgo", "news", "images"] },
  { name: "Shopify", slug: "shopify", description: "Shopify integration for managing products, orders, customers, and inventory. E-commerce automation.", downloads: 17193, version: "1.0.1", tags: ["shopify", "ecommerce", "products", "orders"] },
  { name: "Xiaohongshu Automation", slug: "xiaohongshu-mcp", description: "Automate Xiaohongshu (RedNote) content operations with Python client. Social media management for Chinese market.", downloads: 17137, version: "1.0.0", tags: ["xiaohongshu", "social-media", "chinese", "content"] },
  { name: "n8n Workflow Automation", slug: "n8n-workflow-automation", description: "Design n8n workflow JSON with robust triggers and error handling. Build automation pipelines with visual workflows.", downloads: 17103, version: "1.0.0", tags: ["n8n", "automation", "workflow", "no-code"] },
  { name: "Peekaboo", slug: "peekaboo", description: "Capture and automate macOS UI with the Peekaboo CLI. Screen capture, OCR, and UI interaction.", downloads: 17073, version: "1.0.0", tags: ["macos", "automation", "screen-capture", "ocr"] },
  { name: "Apple Reminders", slug: "apple-reminders", description: "Manage Apple Reminders via the remindctl CLI on macOS. Create, complete, and organize reminders.", downloads: 17020, version: "1.0.0", tags: ["apple", "reminders", "macos", "productivity"] },
  { name: "Markdown.new", slug: "markdown-convert", description: "Convert public web pages into clean Markdown with markdown.new. Extract readable content from any URL.", downloads: 16994, version: "1.0.0", tags: ["markdown", "conversion", "web", "content-extraction"] },
  { name: "Xero Accounting", slug: "xero", description: "Xero API integration with managed OAuth for accounting data. Invoices, contacts, bank transactions, and reports.", downloads: 16972, version: "1.0.4", tags: ["xero", "accounting", "finance", "invoices"] },
  { name: "Google Slides", slug: "google-slides", description: "Google Slides API integration with managed OAuth for presentations. Create, edit, and manage slide decks.", downloads: 16798, version: "1.0.3", tags: ["google", "slides", "presentations", "oauth"] },
  { name: "Sag (Text-to-Speech)", slug: "sag", description: "ElevenLabs text-to-speech with mac-style say UX. Generate natural voice audio from text.", downloads: 16712, version: "1.0.0", tags: ["text-to-speech", "audio", "elevenlabs", "voice"] },
  { name: "Marketing Mode", slug: "marketing-mode", description: "23 comprehensive marketing skills for strategy, copywriting, SEO, social media, and campaign management.", downloads: 16706, version: "1.0.0", tags: ["marketing", "strategy", "copywriting", "seo", "social-media"] },
  { name: "Typeform", slug: "typeform", description: "Typeform API integration with managed OAuth for surveys and forms. Create, manage, and analyze responses.", downloads: 16696, version: "1.0.4", tags: ["typeform", "forms", "surveys", "data-collection"] },
  { name: "Salesforce", slug: "salesforce-api", description: "Salesforce CRM API integration with managed OAuth for SOQL queries. Manage leads, contacts, and opportunities.", downloads: 16653, version: "1.0.4", tags: ["salesforce", "crm", "sales", "leads", "oauth"] },
  { name: "Git Essentials", slug: "git-essentials", description: "Essential Git commands and workflows for version control. Branching, merging, rebasing, and collaboration.", downloads: 16563, version: "1.0.0", tags: ["git", "development", "version-control", "collaboration"] },
  { name: "X (Twitter)", slug: "x-twitter", description: "Interact with Twitter/X — read tweets, search, post, and manage timeline. Social media automation.", downloads: 16436, version: "2.3.1", tags: ["twitter", "social-media", "x", "posting"] },
  { name: "Microsoft Excel", slug: "microsoft-excel", description: "Microsoft Excel API integration with managed OAuth for spreadsheets. Read, write, and analyze Excel data.", downloads: 16354, version: "1.0.3", tags: ["excel", "microsoft", "spreadsheets", "data", "oauth"] },
];

async function main() {
  console.log(`Importing ${skills.length} skills from ClawdHub.ai...`);

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const skill of skills) {
    try {
      const existing = await prisma.catalogSkill.findUnique({
        where: { slug: skill.slug },
      });

      if (existing) {
        await prisma.catalogSkill.update({
          where: { slug: skill.slug },
          data: {
            name: skill.name,
            description: skill.description,
            version: skill.version,
            tags: skill.tags,
            downloads: skill.downloads,
            authorOrg: 'ClawdHub',
          },
        });
        updated++;
        console.log(`  ↻ Updated: ${skill.name} (${skill.slug})`);
      } else {
        await prisma.catalogSkill.create({
          data: {
            slug: skill.slug,
            name: skill.name,
            description: skill.description,
            content: '',
            version: skill.version,
            type: 'PLUGIN',
            entryPoint: '',
            tags: skill.tags,
            authorOrg: 'ClawdHub',
            downloads: skill.downloads,
          },
        });
        created++;
        console.log(`  ✓ Created: ${skill.name} (${skill.slug})`);
      }
    } catch (err: any) {
      errors++;
      console.error(`  ✗ Error: ${skill.name} — ${err.message}`);
    }
  }

  console.log(`\nDone! Created: ${created}, Updated: ${updated}, Errors: ${errors}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
