import type { Express, Request, Response } from "express";
import { VideoConfigSchema, type Job, type VideoConfig } from "@autoayah/core";
import type { Resolver } from "@autoayah/data";
import { videoConfigJsonSchema } from "./openapi.js";

export type McpServices = {
  resolver: () => Resolver;
  preview: (config: VideoConfig) => Promise<unknown>;
  createJob: (config: VideoConfig) => Job;
  getJob: (id: string) => Job | null;
  publicUrl: string;
};

type Tool = { name: string; description: string; inputSchema: Record<string, unknown> };

const configInput = {
  type: "object",
  properties: { config: videoConfigJsonSchema },
  required: ["config"],
};

const tools: Tool[] = [
  {
    name: "list_capabilities",
    description: "List which advanced features are available (word timings, mushaf layout, etc.)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "find_ayat",
    description: "Validate a surah/ayah range reference like 25:7-10 and return surah info",
    inputSchema: {
      type: "object",
      properties: { reference: { type: "string", description: "e.g. 25:7-10 or 1:1" } },
      required: ["reference"],
    },
  },
  { name: "list_reciters", description: "List available Quran reciters", inputSchema: { type: "object", properties: {} } },
  { name: "list_tafsirs", description: "List available tafsirs", inputSchema: { type: "object", properties: {} } },
  { name: "list_translations", description: "List available translations", inputSchema: { type: "object", properties: {} } },
  {
    name: "preview_video",
    description: "Dry-run a video config: returns duration, slide count and warnings without rendering",
    inputSchema: configInput,
  },
  {
    name: "render_video",
    description: "Enqueue a video render. Poll get_job until status is 'done', then download outputUrl.",
    inputSchema: configInput,
  },
  {
    name: "get_job",
    description: "Get render job status by id",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

function parseRef(ref: string): { surah: number; from: number; to: number } {
  const m = ref.trim().match(/^(\d{1,3})\s*:\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/);
  if (!m) throw new Error(`Invalid reference "${ref}". Use e.g. 25:7 or 25:7-10`);
  return { surah: Number(m[1]), from: Number(m[2]), to: Number(m[3] ?? m[2]) };
}

function withUrl(job: Job, publicUrl: string) {
  return job.outputUrl ? { ...job, downloadUrl: new URL(job.outputUrl, publicUrl).toString() } : job;
}

async function callTool(name: string, args: Record<string, unknown>, s: McpServices): Promise<unknown> {
  const resolver = s.resolver();
  switch (name) {
    case "list_capabilities":
      return resolver.capabilities();
    case "find_ayat": {
      const { surah, from, to } = parseRef(String(args.reference ?? ""));
      const meta = (await resolver.getSurahs()).find((x) => x.number === surah);
      if (!meta) throw new Error(`Surah ${surah} does not exist (1-114)`);
      if (from < 1 || to < from || to > meta.numberOfAyahs) throw new Error(`${meta.englishName} has ${meta.numberOfAyahs} ayat`);
      return { surah, from, to, name: meta.name, englishName: meta.englishName, numberOfAyahs: meta.numberOfAyahs };
    }
    case "list_reciters":
      return resolver.getReciters();
    case "list_tafsirs":
      return resolver.getTafsirs();
    case "list_translations":
      return resolver.getTranslations();
    case "preview_video": {
      const props = (await s.preview(VideoConfigSchema.parse(args.config))) as {
        timeline: { totalSeconds: number; slides: unknown[]; width: number; height: number };
        warnings: string[];
      };
      return {
        durationSeconds: props.timeline.totalSeconds,
        slides: props.timeline.slides.length,
        width: props.timeline.width,
        height: props.timeline.height,
        warnings: props.warnings,
      };
    }
    case "render_video":
      return withUrl(s.createJob(VideoConfigSchema.parse(args.config)), s.publicUrl);
    case "get_job": {
      const job = s.getJob(String(args.id ?? ""));
      if (!job) throw new Error("Job not found");
      return withUrl(job, s.publicUrl);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

async function handleRpc(msg: RpcRequest, s: McpServices): Promise<unknown | null> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined) return null; // notification
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: String(msg.params?.protocolVersion ?? "2025-03-26"),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "autoayah", version: "0.2.0" },
        instructions: "Create Quran videos. Never invent Quran text; reference ayat by surah:ayah. Use preview_video before render_video.",
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await callTool(name, args, s);
        return reply({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: { result }, isError: false });
      } catch (e) {
        return reply({ content: [{ type: "text", text: (e as Error).message }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

export function mountMcp(app: Express, services: McpServices) {
  app.post("/mcp", async (req: Request, res: Response) => {
    const body = req.body as RpcRequest | RpcRequest[];
    const batch = Array.isArray(body) ? body : [body];
    if (!batch.length || batch.some((m) => !m || m.jsonrpc !== "2.0" || typeof m.method !== "string")) {
      return void res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
    }
    const replies = (await Promise.all(batch.map((m) => handleRpc(m, services)))).filter((r) => r !== null);
    if (!replies.length) return void res.status(202).end();
    res.json(Array.isArray(body) ? replies : replies[0]);
  });
  app.get("/mcp", (_req, res) => void res.status(405).set("Allow", "POST").json({ error: "Use POST (stateless streamable HTTP)" }));

  // Simple REST shim for scripts that don't speak MCP.
  app.get("/mcp/tools", (_req, res) => res.json({ tools }));
  app.post("/mcp/call", async (req: Request, res: Response) => {
    try {
      const result = await callTool(String(req.body?.name ?? ""), (req.body?.arguments ?? {}) as Record<string, unknown>, services);
      res.json({ ok: true, result });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });
}
