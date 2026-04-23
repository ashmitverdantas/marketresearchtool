# Verdantas Market Tool v7 — Node.js

6-Month Forward Organic Growth Outlook — Engineering Services Intelligence.

## Quick Start

```bash
npm install        # first time only
npm start          # starts server on http://localhost:3000
```

Open **http://localhost:3000** in your browser.

## Project Structure

```
verdantas-market-tool/
├── server.js            # Express server (entry point)
├── package.json
├── data/                # JSON data files (update monthly)
│   ├── b2b_data.json
│   ├── config.json
│   ├── external_market_data.json
│   ├── inflation_data.json
│   ├── tuning_inputs.json
│   └── ute_data.json
└── public/              # Static frontend (served as-is)
    ├── index.html
    └── app.js
```

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/config` | Tool configuration |
| `GET /api/tuning_inputs` | Market weights & geo slider defaults |
| `GET /api/b2b_data` | Firmwide B2B ratios & P&L series |
| `GET /api/external_market_data` | External market narratives & growth estimates |
| `GET /api/ute_data` | Utilisation actuals & goals |
| `GET /api/inflation_data` | PPI & ECI quarterly indices |
| `GET /api/health` | JSON health check (data file presence) |

## Monthly Update Workflow

1. Update `data/b2b_data.json`
2. Update `data/ute_data.json`
3. Run Claude using `claude_prompt_template.txt`, paste the JSON output into `data/external_market_data.json`
4. Restart the server (or it hot-reloads with `npm run dev`)

## Development (hot reload)

```bash
npm run dev   # requires Node 18+
```

## Port

Default port is **3000**. Override with the `PORT` environment variable:

```bash
PORT=8080 npm start
```
