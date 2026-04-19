# deep-agents-test

A LangChain Deep Agents project in TypeScript — a research agent with planning, file system tools, and internet search capabilities.

## Prerequisites

- Node.js 18+
- An API key from a model provider (Anthropic, OpenAI, Google, etc.)
- A [Tavily](https://tavily.com/) API key for web search

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your API keys
```

## Usage

```bash
# Run with default query
npm start

# Run with a custom query
npm start "What are the latest advances in AI agents?"
```

## Learn More

- [Deep Agents Overview](https://docs.langchain.com/oss/javascript/deepagents/overview)
- [Deep Agents Quickstart](https://docs.langchain.com/oss/javascript/deepagents/quickstart)
- [deepagents on npm](https://www.npmjs.com/package/deepagents)
- [deepagentsjs on GitHub](https://github.com/langchain-ai/deepagentsjs)
