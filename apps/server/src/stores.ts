import { randomUUID } from "node:crypto";
import { projectName, type Project, type VideoConfig } from "@autoayah/core";
import { decrypt, encrypt } from "./crypto.js";
import type { Db } from "./db/index.js";

export type ApiKeys = {
  pexels?: string;
  unsplash?: string;
  pixabay?: string;
  freesound?: string;
  qfClientId?: string;
  qfClientSecret?: string;
};

export class DbStore {
  constructor(
    private db: Db,
    private appSecret: string,
  ) {}

  listProjects(): Project[] {
    return this.db.listProjects().map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      config: JSON.parse(p.config_json) as VideoConfig,
    }));
  }

  getProject(id: string): Project | null {
    const p = this.db.getProject(id);
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      config: JSON.parse(p.config_json) as VideoConfig,
    };
  }

  /** Projects are named by their attributes; saving a video that already has a project updates that project. */
  saveProject(input: { id?: string; config: VideoConfig }): Project {
    const now = new Date().toISOString();
    const name = projectName(input.config);
    const sameName = this.db.listProjects().find((p) => p.name === name);
    const id = sameName?.id ?? input.id ?? randomUUID();
    const existing = this.getProject(id);
    this.db.upsertProject({
      id,
      name,
      config_json: JSON.stringify(input.config),
      created_at: existing?.createdAt ?? now,
      updated_at: now,
    });
    return {
      id,
      name,
      config: input.config,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  deleteProject(id: string) {
    this.db.deleteProject(id);
  }

  getKeys(): ApiKeys {
    const row = this.db.getSecret("api_keys");
    if (!row) return {};
    try {
      return JSON.parse(decrypt(this.appSecret, row.value_enc)) as ApiKeys;
    } catch {
      return {};
    }
  }

  /** Re-encrypt keys saved under a previous secret (e.g. the old built-in default). */
  migrateSecret(previousSecret: string) {
    if (previousSecret === this.appSecret) return;
    const row = this.db.getSecret("api_keys");
    if (!row) return;
    try {
      decrypt(this.appSecret, row.value_enc);
      return;
    } catch {
      /* not readable with the current secret */
    }
    try {
      this.setKeys(JSON.parse(decrypt(previousSecret, row.value_enc)) as ApiKeys);
    } catch {
      /* unknown secret — leave as is */
    }
  }

  setKeys(keys: ApiKeys) {
    const now = new Date().toISOString();
    this.db.upsertSecret({
      key: "api_keys",
      value_enc: encrypt(this.appSecret, JSON.stringify(keys)),
      updated_at: now,
    });
  }
}
