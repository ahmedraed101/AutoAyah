import { useCallback, useEffect, useState } from "react";
import type { Job } from "@autoayah/core";
import { api } from "./api";

export const isActive = (j: Pick<Job, "status">) => j.status === "queued" || j.status === "rendering";

/** Recent render jobs, polled while any of them is waiting or rendering. */
export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const refresh = useCallback(() => api.jobs().then(setJobs), []);
  const active = jobs.some(isActive);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => void refresh().catch(() => undefined), 1500);
    return () => clearInterval(id);
  }, [active, refresh]);

  /** Show a job the server just returned without waiting for the next poll. */
  const upsert = useCallback((job: Job) => setJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)]), []);

  return { jobs, refresh, upsert };
}
