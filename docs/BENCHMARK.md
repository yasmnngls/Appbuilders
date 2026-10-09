# Benchmark — tested laptop

> Derived from PRD-product.md v1.2 — if they disagree, PRD-product.md wins.

Only measured numbers are recorded here (PRD §14A.6, §14A.7, BUILD_PLAN M11.3). Rows that need a browser run are marked pending; nothing is estimated.

## Machine

| | |
|---|---|
| Laptop | ASUS Vivobook K3605VC |
| CPU | 13th Gen Intel Core i5-13420H |
| GPU | NVIDIA GeForce RTX 3050 4GB Laptop GPU (4096 MiB, driver 581.57) |
| System RAM | 7,862 MB (7.7 GB) |
| OS | Windows 11 Home Single Language 10.0.26200 |
| Ollama | 0.40.1 |
| Node | v24.18.0 |
| Installed models from `MODEL_PREFERENCE` | `qwen2.5:3b` only (`qwen3:4b`, `qwen3:1.7b` not installed) |
| Date | 2026-10-10 |

Sources: `systeminfo`, `Win32_Processor`, `nvidia-smi`, `ollama -v`, `ollama list`.

## Local LLM (§14A.6 "Vision + Local LLM", LLM part)

Command: `npm run bench:llm` ([scripts/bench-llm.mjs](../scripts/bench-llm.mjs)).

Method: the model is unloaded (`keep_alive: 0`), then loaded cold with a 1-token call. Then 5 calls for each of three fixed §28 Moments (reading-like pattern on "Tell me about a project you led", off-screen on "How do you debug a production outage", second face on "Describe a disagreement with a teammate", the last with `final: true`). Each call uses the app's real `CONTRACT_SYSTEM`, `CONTRACT_SCHEMA`, `contractUserMessage`, `temperature: 0` and `num_predict: 200`, sent straight to `http://127.0.0.1:11434/api/chat`. Every answer goes through the app's `checkQuality` / `findBanned`. The pass rule matches `writeSuggestion`: neutral, with a non-empty note and follow-up. Latency is wall time per call. p50/p95 use nearest rank over 15 calls, so p95 here equals the slowest call.

| Model | Cold load (wall) | Ollama `load_duration` | p50 | p95 | max | Gen tok/s (mean) | Guard pass | Specific | Grounded | Banned-word hits | Memory (`/api/ps`) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| qwen2.5:3b | 11,445 ms | 11,192 ms | 5,912 ms | 12,645 ms | 12,645 ms | 14.5 | 15/15 (100%) | 15/15 | 15/15 | 0 | 2.01 GB, all in VRAM |

| Moment | p50 | Guard pass |
|---|---|---|
| reading-like pattern | 5,912 ms | 5/5 |
| off-screen | 6,670 ms | 5/5 |
| second face | 4,782 ms | 5/5 |

`ollama ps` after load: `qwen2.5:3b · 2.2 GB · 100% GPU · context 4096`.

Notes:
- 14 of 15 calls took 4.7–6.8 s. One off-screen call took 12.6 s. In the app, a call over `LLM.slowMs` (8 s) switches to a lighter installed model. On this laptop there is no lighter model installed, so the app stays on `qwen2.5:3b`. A call that fails or passes 20 s gets the template suggestion.
- An earlier run on the same day gave a cold load of 12,032 ms and p50 of 5,726 ms. That run used `max_follow_ups: 3` instead of the app's 2, so only the run above is reported.
- The GPU was not reserved for the benchmark: another session had loaded the same model just before the run, and other apps were open.
- Only `qwen2.5:3b` is installed, so there is no Qwen3 row and no lighter-model row.

## §14A.6 rows

| Test | Metrics | Result |
|---|---|---|
| Vision only | FPS, CPU, GPU, RAM, dropped frames | pending manual run — see README offline checklist |
| Vision + Dashboard | FPS, RAM, UI responsiveness | pending manual run — see README offline checklist |
| Vision + Local LLM | LLM load time, generation latency, RAM/VRAM | LLM alone measured above (cold load 11.4 s, p50 5.9 s, 2.01 GB VRAM). With vision running at the same time: pending manual run — see README offline checklist |
| Full pipeline | pattern → follow-up latency | pending manual run — see README offline checklist |
| Lightweight fallback | same metrics, smaller model / CPU path | pending manual run — see README offline checklist (no smaller model installed on this laptop) |
| Offline mode | core AI loop continues with internet off (pass/fail) | pending manual run — see README offline checklist |

To fill in the pending rows, run the app (`npm run build && npm run preview`) and follow BUILD_PLAN §14 and the README offline test. Read fps, the vision delegate, the last LLM latency and the gate-to-suggestion latency from the Live screen's diagnostics panel. Read CPU and GPU from Task Manager.
