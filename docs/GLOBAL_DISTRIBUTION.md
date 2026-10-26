# Global Agent & MCP Discoverability Guide

Streamlivr's creator discovery APIs, Model Context Protocol (MCP) servers, and autonomous agent skills are officially published and indexed across major AI registries, developer environments, and frontier model ecosystems.

---

## 1. Registry & Marketplace Directory

| Ecosystem / Layer | Surface Name | Verified Status | Reference & Listing Link |
| :--- | :--- | :---: | :--- |
| **Official Global MCP Registry** | [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/)<br>*(Anthropic & Linux Foundation)* | 🟢 **LIVE & ACTIVE** | Published as [`io.github.StreamlivrApp/streamlivr@1.0.0`](https://registry.modelcontextprotocol.io/v0/servers?search=streamlivr). Resolves to `https://api.streamlivr.com/mcp`. |
| **OpenAI & ChatGPT Ecosystem** | [ChatGPT Plugins / Custom MCP](https://chatgpt.com/plugins) | 🟢 **ACTIVE** | Installed and verified as remote MCP plugin. Turnkey Action schema available at `https://api.streamlivr.com/openapi.json`. |
| **Developer IDE Extensions** | [Cursor Directory](https://cursor.directory/) | 🟢 **LIVE** | Live community plugin at [`cursor.directory/plugins/streamlivr`](https://cursor.directory/plugins/streamlivr). |
| **Universal MCP Catalogs** | [Glama.ai](https://glama.ai/) | 🟢 **LIVE** | Live connector at [`glama.ai/mcp/connectors/com.streamlivr.api/streamlivr`](https://glama.ai/mcp/connectors/com.streamlivr.api/streamlivr). Verified Ownership, Healthy status, TDQS: 3.9/5.0. |
| **Autonomous Celo Marketplaces** | [usebuy.ai](https://usebuy.ai/) *(Celo Buy Skill)* | 🟢 **LIVE** | Approved listing in `celo-org/buy-skill` for autonomous machine purchasing via `@celo/buy`. |
| **On-Chain Agent Identity** | [Aigora.org](https://aigora.org/) *(ERC-8004)* | 🟢 **LIVE** | On-chain agent record on Celo Mainnet: [`aigora.org/services/42220_0x8004a..._9852`](https://aigora.org/services/42220_0x8004a169fb4a3325136eb29fa0ceb6d2e539a432_9852). |
| **Open-Source LLMs & Multi-Modal** | [Agensi.io](https://www.agensi.io/) *(Meta Muse & Llama)* | 🟢 **LIVE** | Official skill listing at [`agensi.io/skills/streamlivr`](https://www.agensi.io/skills/streamlivr). |
| **Decentralized x402 Crawlers** | [agent402.tools](https://agent402.tools/) & [x402.new](https://x402.new/) | 🤖 **INDEXED** | Automatically indexed via `extensions.bazaar` payload and `/.well-known/x402`. |
| **Frontier LLM Agent Marketplace** | [xAI Grok Plugin Marketplace](https://github.com/xai-org/plugin-marketplace) | 🟡 **IN REVIEW** | Submitted via [PR #1684](https://github.com/xai-org/plugin-marketplace/pull/1684) (`feat(plugins): add Streamlivr MCP creator & music discovery plugin`). |
| **Developer Coding Assistant** | [Cline Marketplace](https://marketplace.cline.bot/) | 🟡 **SUBMITTED** | Submission issue filed on `github.com/cline/mcp-marketplace`. |

---

## 2. Technical Connection Endpoints

Autonomous agents, IDEs, and LLMs can connect to Streamlivr via any of the following standard interfaces:

- **Remote Streamable HTTP MCP Server:**
  ```text
  https://api.streamlivr.com/mcp
  ```
- **OpenAPI 3.1 Specification:**
  ```text
  https://api.streamlivr.com/openapi.json
  ```
- **A2A Agent Card:**
  ```text
  https://api.streamlivr.com/.well-known/agent.json
  ```
- **x402 Discovery Metadata:**
  ```text
  https://api.streamlivr.com/.well-known/x402
  ```

---

## 3. Client & Agent Configuration Guides

### A. OpenAI & ChatGPT (Plugin / Custom MCP)
1. Open [chatgpt.com/plugins](https://chatgpt.com/plugins) or click **Settings → Connected Apps / Add MCP Server**.
2. **Server Name:** `streamlivr`
3. **Server URL:** `https://api.streamlivr.com/mcp`
4. **Authentication:** Select `None` (public discovery is free; paid queries settle via x402 headers).
5. Alternatively, for Custom Actions / Custom GPTs, import OpenAPI schema from `https://api.streamlivr.com/openapi.json`.

### B. Claude Desktop & Cursor
Add to your `claude_desktop_config.json` or `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "streamlivr": {
      "url": "https://api.streamlivr.com/mcp"
    }
  }
}
```

Or reference the official registry identifier:
```text
io.github.StreamlivrApp/streamlivr
```

### C. TypeScript / Node.js Agents (`@modelcontextprotocol/sdk`)
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const transport = new SSEClientTransport(
  new URL("https://api.streamlivr.com/mcp")
);
const client = new Client({ name: "my-agent", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

// List available creator discovery tools
const tools = await client.listTools();
console.log(tools);
```

### D. Python Agents (`mcp`)
```python
import asyncio
from mcp import ClientSession
from mcp.client.sse import sse_client

async def main():
    async with sse_client("https://api.streamlivr.com/mcp") as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            print("Available Streamlivr tools:", [t.name for t in tools.tools])

asyncio.run(main())
```

---

## 4. Settling x402 Micropayments Autonomously

When querying paid endpoints (`/api/v1/agent/listings`, `/api/v1/agent/posts`, `/api/v1/agent/catalog`):
1. **Challenge:** Streamlivr returns `HTTP 402 Payment Required` specifying `$0.01 USDC` on Celo Mainnet (`eip155:42220`).
2. **Signature:** The client signs an EIP-3009 transfer authorization off-chain.
3. **Facilitator:** The request is retried with the signed authorization; Celo's hosted facilitator pays the gas.
4. **Attribution & Revenue Split:** 60% of the payment is credited directly to the creators whose data was returned, and 40% settles to the protocol.

