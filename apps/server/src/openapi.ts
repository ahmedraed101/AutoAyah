import { zodToJsonSchema } from "zod-to-json-schema";
import { JobSchema, VideoConfigSchema } from "@autoayah/core";

export const videoConfigJsonSchema = zodToJsonSchema(VideoConfigSchema, { target: "openApi3", $refStrategy: "none" });
const jobJsonSchema = zodToJsonSchema(JobSchema, { target: "openApi3", $refStrategy: "none" });

const idParam = [{ name: "id", in: "path", required: true, schema: { type: "string" } }];
const configBody = { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/VideoConfig" } } } };
const jobResponse = { "200": { description: "Job", content: { "application/json": { schema: { $ref: "#/components/schemas/Job" } } } } };

export function openApiSpec(publicUrl: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "AutoAyah API",
      version: "0.2.0",
      description:
        "Generate Quran videos. Quran text is always fetched by surah/ayah reference. Typical flow: GET /api/surahs, POST /api/preview, POST /api/jobs, then GET /api/jobs/{id} until status is done and download outputUrl.",
    },
    servers: [{ url: publicUrl }],
    paths: {
      "/api/health": { get: { summary: "Health", responses: { "200": { description: "OK" } } } },
      "/api/config": { get: { summary: "App config and capabilities", responses: { "200": { description: "Config" } } } },
      "/api/surahs": { get: { summary: "List surahs", responses: { "200": { description: "Surahs" } } } },
      "/api/reciters": { get: { summary: "List reciters", responses: { "200": { description: "Reciters" } } } },
      "/api/divisions": {
        get: { summary: "Juz, hizb, rub', page and manzil boundaries", responses: { "200": { description: "Divisions by kind" } } },
      },
      "/api/tafsirs": { get: { summary: "List tafsirs", responses: { "200": { description: "Tafsirs" } } } },
      "/api/translations": { get: { summary: "List translations", responses: { "200": { description: "Translations" } } } },
      "/api/preview": {
        post: {
          summary: "Dry-run: resolved slides, duration and warnings without rendering",
          parameters: [
            {
              name: "draft",
              in: "query",
              required: false,
              description: "1 = text only: no recitation audio or word timings, durations are estimates",
              schema: { type: "string", enum: ["1"] },
            },
          ],
          requestBody: configBody,
          responses: { "200": { description: "Composition props" } },
        },
      },
      "/api/jobs": {
        get: { summary: "List render jobs", responses: { "200": { description: "Jobs" } } },
        post: { summary: "Enqueue a render (identical finished renders are reused)", requestBody: configBody, responses: jobResponse },
      },
      "/api/jobs/{id}": {
        get: { summary: "Get job", parameters: idParam, responses: jobResponse },
        delete: { summary: "Delete job and its files", parameters: idParam, responses: { "200": { description: "Deleted" } } },
      },
      "/api/jobs/{id}/cancel": { post: { summary: "Cancel job", parameters: idParam, responses: jobResponse } },
      "/api/jobs/{id}/retry": { post: { summary: "Retry failed or cancelled job", parameters: idParam, responses: jobResponse } },
      "/api/jobs/{id}/events": { get: { summary: "SSE job progress", parameters: idParam, responses: { "200": { description: "text/event-stream of Job" } } } },
      "/api/media/search": {
        post: {
          summary: "Search stock media with people filtered out",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { query: { type: "string" }, kind: { type: "string", enum: ["image", "video"] }, keys: { type: "object" } },
                },
              },
            },
          },
          responses: { "200": { description: "Results" } },
        },
      },
      "/mcp": { post: { summary: "Model Context Protocol endpoint (JSON-RPC 2.0, streamable HTTP, stateless)", responses: { "200": { description: "JSON-RPC response" } } } },
    },
    components: { schemas: { VideoConfig: videoConfigJsonSchema, Job: jobJsonSchema } },
  };
}
