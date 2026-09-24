# SAS Cargo Copilot

AI-powered customer-support copilot for SAS Cargo. It triages inbound freight-forwarder
emails, extracts cargo entities, grounds its reasoning in real SAS Cargo business rules, and
drafts a ready-to-send reply — surfaced natively inside Outlook, a web UI, and a REST API.

Built for the SAS AI Hackathon (Track 3: AI-Powered Customer Support in SAS Cargo).

## What it does

- **Classifies intent** — Track & Trace, Dimension/Rate Quote, Pharma Escalation.
- **Extracts entities** — AWB (117- prefix), route, pieces, weight, volume, dimensions,
  commodity, special cargo.
- **Grounds every figure** — chargeable weight (166.66 volumetric rule), suggested rate for a
  ≥15% contribution margin, loadability limits (≤161 cm) with RFS→widebody routing.
- **Retrieval-Augmented Generation** — answers cite SAS Cargo business rules from an Azure AI
  Search knowledge base.
- **Drafts a reply** — professional, ready-to-send, with mandatory human-in-the-loop review.

## Architecture

```
Email (Outlook add-in / Web UI / API)
        │
        ▼
Express + TypeScript backend  ── requireApiKey (external callers)
        │
        ├─ Azure AI Foundry prompt agent (GPT-5, CDX)  ── RAG via Azure AI Search
        │      └─ strict JSON schema output (cargo_analysis)
        ├─ Contribution engine (166.66 rule, 15% margin, suggested rate)
        └─ Graceful fallback: Azure GPT-5 chat → OpenAI → mock
```

Priority chain in `/api/copilot/analyze`: **Foundry agent → Azure GPT-5 chat → OpenAI → mock**.

## Project structure

```
sas-cargo-copilot/
├── src/
│   ├── server.ts        # Express API + Foundry agent + fallbacks
│   └── calculations.ts  # Contribution engine (mock of the /calculations API)
├── public/
│   ├── index.html       # 3-pane Outlook-style web copilot
│   └── addin/           # Outlook add-in task pane + icons
├── manifest.xml         # Outlook add-in manifest
└── .env.example         # Configuration template
```

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 (or https://localhost:3000 when SSL certs are configured for the
Outlook add-in).

## Configuration

Copy `.env.example` to `.env` and fill in the values.

| Variable | Purpose |
|---|---|
| `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_API_KEY` | Azure Foundry GPT-5 (chat fallback) |
| `AZURE_OPENAI_DEPLOYMENT` | Chat deployment name (default `gpt-5`) |
| `FOUNDRY_PROJECT_ENDPOINT` / `FOUNDRY_AGENT_NAME` | Governed Foundry prompt agent (Entra auth) |
| `CALCULATIONS_API_URL` / `CALCULATIONS_API_KEY` | Real contribution API (falls back to mock) |
| `API_KEY` | Guards the API for external callers (Power Automate / Salesforce) |
| `SSL_KEY_PATH` / `SSL_CERT_PATH` | Serve HTTPS on localhost (for the Outlook add-in) |

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | Health check |
| `GET /api/emails` | Demo seed emails |
| `POST /api/copilot/analyze` | Analyze an email — demo `emailId` or raw `{sender, senderCompany, subject, body}` |
| `POST /api/calculations` | Chargeable weight + contribution estimate |

## Outlook add-in

Sideload `manifest.xml` via https://aka.ms/olksideload (My add-ins → Custom Addins → Add from
file). Open an email → **Cargo Copilot** → **Analyze this email** → **Insert reply**.

## Human-in-the-loop

The copilot never sends autonomously. High-liability cargo (Pharma, Dangerous Goods) is flagged
for specialist review; all drafts require agent confirmation before sending.

## Grounding source

Business rules derived from the SAS Cargo contribution model
(`cargo-contribution-model` `BUSINESS_DOCUMENTATION.md`): the 166.66 chargeable-weight rule,
the 15% approval margin, loadability tables, and Special Cargo SOPs.
