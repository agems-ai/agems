# Ollama integration

AGEMS supports [Ollama](https://ollama.com) as an LLM provider so you can run agents locally without any cloud API key. Useful for development, privacy-sensitive workloads, and learning the platform without a paid account.

## When to use Ollama

- You want to try AGEMS without signing up for OpenAI / Anthropic / Google.
- You're building agents that handle private data and want them to stay on a local machine.
- You're testing prompts and don't want every iteration to cost money.

## When NOT to use Ollama

- Production multi-agent workloads. Local models lag behind frontier models on tool calling, instruction following, and long-context reasoning.
- Tasks that need vision. Most Ollama-served models are text-only; AGEMS already routes vision through cloud providers.
- Tasks that depend on heavy tool use. Smaller open models drop tool calls or call them with malformed JSON, especially under load.

## 1. Install and start Ollama

```bash
# macOS / Linux: official installer
curl -fsSL https://ollama.com/install.sh | sh

# or via Homebrew on macOS
brew install ollama

# Start the server (runs on :11434)
ollama serve
```

Verify it's reachable:

```bash
curl -s http://localhost:11434/api/tags | head
```

## 2. Pull a model

Recommended starting points (CPU/GPU permitting):

| Model | Size (Q4_K_M) | Strengths | AGEMS notes |
|---|---|---|---|
| `llama3.2:3b` | ~2 GB | Fast, runs on most laptops | Good for simple agents, weak tool use |
| `llama3.1:8b` | ~5 GB | Balanced | Decent tool calling |
| `mistral:7b` | ~4 GB | Solid generalist | OK for chat-style agents |
| `qwen2.5:7b` | ~4.7 GB | Strong reasoning | Best small-model tool calling we've tested |
| `qwen2.5:14b` | ~9 GB | Stronger reasoning | Tool calling reliable on a 16 GB GPU |
| `gemma2:9b` | ~5.5 GB | Good chat quality | Tool calls drop more often than Qwen |

```bash
ollama pull qwen2.5:7b
```

## 3. Configure AGEMS

Set the Ollama base URL via environment variable (optional — defaults are sane):

```bash
# .env
OLLAMA_BASE_URL=http://localhost:11434/v1
```

If AGEMS runs in Docker on the same host, point it at the host network instead:

```bash
# .env
OLLAMA_BASE_URL=http://host.docker.internal:11434/v1     # Mac / Windows
# or
OLLAMA_BASE_URL=http://172.17.0.1:11434/v1               # Linux default bridge
```

In the AGEMS web UI, go to **Settings → LLM Keys** and add an Ollama entry. The "API key" field can be left empty or set to any string (the platform sends `ollama` as a placeholder for OpenAI-compatible auth).

## 4. Create an agent that uses Ollama

In **Agents → New agent** select:

- Provider: `Ollama`
- Model: the exact tag you pulled (e.g. `qwen2.5:7b`)
- System prompt: anything

Save the agent. Open a channel, add the agent as a participant, and message it. The agent will respond using your local model.

## 5. Verify in the runtime

Tail the API logs while sending a message:

```bash
docker compose logs -f api | grep -i ollama
```

You should see a request go to `:11434`. If you see auth errors, double-check the base URL and that `ollama serve` is actually running.

## Tool-calling caveats

AGEMS uses the OpenAI-compatible chat-completions endpoint Ollama exposes, plus a JSON-schema mode for tool definitions. Smaller models (under ~7 B parameters) frequently:

- emit malformed JSON arguments that `repairToolCall` has to fix,
- ignore the tool list and answer in plain text instead,
- loop on the same tool when the result isn't shaped how they expect.

Mitigations already in the runner:

- A loop detector kills repeated tool calls (`runner.ts → ToolLoopDetector`).
- A no-tools retry fallback for Ollama-specific errors (`runner.ts → runStreamOllama`).
- An execution timeout (default 5 min, override with `executionTimeoutMs` in the agent's `llmConfig`).

If a small model still misbehaves, prefer `qwen2.5:7b` or step up to `qwen2.5:14b`. They follow tool schemas more reliably than Llama or Gemma at the same size.

## Limitations

- No vision input. AGEMS skips image attachments when the provider is Ollama.
- Long conversations regress faster than they do on frontier APIs.
- Streaming behaviour mirrors the OpenAI shape; some Ollama-only fields (e.g. `delta.reasoning` for Gemma chain-of-thought) are merged into the thinking trace, but not all token types are surfaced.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:11434` | Ollama not running | `ollama serve` |
| `Cannot reach OLLAMA. Network or service may be down.` | Base URL wrong | Adjust `OLLAMA_BASE_URL` for your network |
| `Conversation too long for this model.` | Context window exceeded | Pick a model with a larger ctx (`qwen2.5:7b` = 32 K) or trim history |
| Agent answers but never calls tools | Model too small / format mismatch | Switch to `qwen2.5:7b+`. Verify the tool's `parameters` schema is valid JSON Schema |
| Repeated identical tool calls | Loop detector should already trip | Check API logs for the loop-detector warning; consider lowering `maxIterations` for that agent |

## What about embeddings?

AGEMS doesn't currently use Ollama for embeddings. If you need them, run `ollama pull nomic-embed-text` and consume the model directly via `/api/embeddings` from your own integration; this is outside the agent runtime today.
