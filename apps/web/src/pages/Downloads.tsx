import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { api, type DownloadRequest, type DownloadTask, type LibraryGroup, type LibraryType } from "../api";
import { entryName, groupBy, languageName, useCatalog, type CatalogEntry } from "../catalog";
import { Field, Segmented, Select } from "../components/controls";
import { Icon } from "../components/Icon";
import { Empty } from "../components/SurahLabel";
import { useEditor } from "../store";
import { localDigits, useSurahs, type Surah } from "../surahs";

type Kind = DownloadRequest["type"];
type Scope = "whole" | "one" | "range";
type Form = { type: Kind; ids: Partial<Record<Kind, string>>; scope: Scope; from: number; to: number };

const KINDS: Kind[] = ["recitation", "mushaf", "tafsir", "translation"];
const SECTIONS: LibraryType[] = ["recitation", "mushaf", "tafsir", "translation", "text", "backgrounds", "imports", "app"];
const MUSHAF_PAGES = 604;
const ACTIVE = new Set<DownloadTask["status"]>(["queued", "running"]);

const formatBytes = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

const sourceOf = (id: string) => (/^(qc|qdc|qdcch)-\d+$/.test(id) ? "Quran.com" : /^[a-z]{2,3}\.[\w-]+$/.test(id) ? "AlQuran.cloud" : "EveryAyah");

/** "1–3, 5, 293–304" */
function pageRanges(pages: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const start = pages[i]!;
    while (pages[i + 1] === pages[i]! + 1) i++;
    out.push(start === pages[i] ? `${start}` : `${start}–${pages[i]}`);
  }
  return out.join(", ");
}

export function Downloads() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { config } = useEditor();
  const surahs = useSurahs();
  const catalog = useCatalog();
  const [groups, setGroups] = useState<LibraryGroup[]>([]);
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const [form, setForm] = useState<Form>({
    type: "recitation",
    ids: { recitation: config.reciter, tafsir: config.tafsir ?? undefined, translation: config.translation ?? undefined },
    scope: "one",
    from: config.surah,
    to: config.surah,
  });
  const formRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.library();
      setGroups(data.groups);
      setTasks(data.downloads);
      setTotalBytes(data.totalBytes);
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = tasks.some((x) => ACTIVE.has(x.status));
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => void load(), 1500);
    return () => clearInterval(id);
  }, [active, load]);

  const act = (p: Promise<unknown>) =>
    void p
      .then(() => {
        setError(undefined);
        return load();
      })
      .catch((e: Error) => setError(e.message));

  const surahName = (n: number) => {
    const s = surahs.find((x) => x.number === n);
    if (!s) return `${t("surah")} ${localDigits(n, lang)}`;
    return lang === "ar" ? s.name : s.englishName;
  };
  const scopeLabel = (from: number, to: number) =>
    from === 1 && to === 114 ? t("wholeQuran") : from === to ? surahName(from) : t("surahSpan", { from: surahName(from), to: surahName(to) });

  const listFor = (type: Kind): CatalogEntry[] =>
    type === "recitation" ? catalog.reciters : type === "tafsir" ? catalog.tafsirs : type === "translation" ? catalog.translations : [];
  const itemName = (type: Kind | LibraryType, id?: string) => {
    if (type === "mushaf") return t("mushafMadani");
    const group = groups.find((g) => g.type === type && g.id === id);
    if (group) return groupTitle(group);
    return id ? entryName(listFor(type as Kind), id, lang) : "";
  };
  const groupTitle = (g: LibraryGroup) => {
    if (g.type === "mushaf") return t("mushafMadani");
    if (g.type === "text") return t("quranText");
    if (g.type === "app") return t("appData");
    if (g.type === "backgrounds") return t(g.id === "full" ? "bgFull" : "bgPreviews");
    return (lang === "ar" && g.nameAr) || g.name;
  };

  /** Language, plus the source when two saved items would otherwise look identical. */
  const subtitleOf = (g: LibraryGroup, siblings: LibraryGroup[]) => {
    const norm = (x: LibraryGroup) => groupTitle(x).toLowerCase().replace(/[^\p{L}]/gu, "");
    const language = g.language ? languageName(g.language, lang) : "";
    const parts = [norm(g) === language.toLowerCase().replace(/[^\p{L}]/gu, "") ? "" : language];
    const everyAyah = g.type === "recitation" && sourceOf(g.id) === "EveryAyah";
    if (everyAyah || siblings.some((x) => x !== g && norm(x) === norm(g))) parts.push(sourceOf(g.id));
    return parts.filter(Boolean).join(" · ") || undefined;
  };

  const download = (req: DownloadRequest) => act(api.startDownload(req));

  const prefill = (type: Kind, id: string) => {
    setForm((f) => ({ ...f, type, ids: id ? { ...f.ids, [type]: id } : f.ids }));
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const remove = (g: LibraryGroup, surah?: number) => {
    const what = surah ? `${groupTitle(g)} — ${surahName(surah)}` : groupTitle(g);
    if (!window.confirm(t("confirmDelete", { name: what }))) return;
    act(api.removeLibrary({ type: g.type, id: g.id, surah }));
  };

  const visibleTasks = tasks.filter((x) => x.status !== "cancelled");
  const sections = SECTIONS.map((type) => [type, groups.filter((g) => g.type === type)] as const).filter(([, list]) => list.length);

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t("downloads")}</h1>
        {loaded ? <span className="usage-pill">{t("storageUsed", { size: formatBytes(totalBytes) })}</span> : null}
      </header>
      <p className="page-intro">{t("offlineIntro")}</p>
      {error ? <p className="notice error">{error}</p> : null}

      <DownloadForm
        ref={formRef}
        form={form}
        setForm={setForm}
        surahs={surahs}
        listFor={listFor}
        onSubmit={(req) => download(req)}
      />

      {visibleTasks.length ? (
        <section className="section">
          <div className="section-head">
            <h2>{t("inProgress")}</h2>
            {visibleTasks.some((x) => !ACTIVE.has(x.status)) ? (
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => act(Promise.all(visibleTasks.filter((x) => !ACTIVE.has(x.status)).map((x) => api.dismissDownload(x.taskId))))}
              >
                {t("clearFinished")}
              </button>
            ) : null}
          </div>
          <ul className="list">
            {visibleTasks.map((task) => (
              <TaskRow
                key={task.taskId}
                task={task}
                title={itemName(task.type, task.id)}
                scope={scopeLabel(task.surahFrom, task.surahTo)}
                onCancel={() => act(api.dismissDownload(task.taskId))}
                onRetry={() => download({ type: task.type, id: task.id, surahFrom: task.surahFrom, surahTo: task.surahTo })}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="section">
        <h2>{t("onDevice")}</h2>
        {loaded && !groups.length ? <Empty title={t("nothingSaved")} hint={t("nothingSavedHint")} /> : null}
        {sections.map(([type, list]) => (
          <div key={type} className="lib-section">
            <h3>{t(`sec_${type}`)}</h3>
            {type === "text" || type === "app" || type === "recitation" || type === "backgrounds" ? <p className="field-hint">{t(`secHint_${type}`)}</p> : null}
            <ul className="list">
              {list.map((g) => (
                <GroupRow
                  key={`${g.type}|${g.id}`}
                  group={g}
                  title={groupTitle(g)}
                  subtitle={subtitleOf(g, list)}
                  surahName={surahName}
                  onDelete={(surah) => remove(g, surah)}
                  onFinish={(surah) => download({ type: g.type as Kind, id: g.id, surahFrom: surah, surahTo: surah })}
                  onMore={
                    g.type === "recitation" || g.type === "tafsir" || g.type === "translation" || g.type === "mushaf"
                      ? () => prefill(g.type as Kind, g.type === "mushaf" ? "" : g.id)
                      : undefined
                  }
                />
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="section">
        <h2>{t("advanced")}</h2>
        <p className="page-intro">{t("qulHint")}</p>
        <div className="btn-row">
          <label className="btn btn-quiet">
            <Icon name="upload" size={18} />
            {t("importQul")}
            <input
              type="file"
              accept=".json,.sqlite,.db,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) act(api.importLibrary(f));
              }}
            />
          </label>
        </div>
      </section>
    </div>
  );
}

function DownloadForm({
  ref,
  form,
  setForm,
  surahs,
  listFor,
  onSubmit,
}: {
  ref: Ref<HTMLElement>;
  form: Form;
  setForm: (f: Form | ((f: Form) => Form)) => void;
  surahs: Surah[];
  listFor: (type: Kind) => CatalogEntry[];
  onSubmit: (req: DownloadRequest) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const items = listFor(form.type);
  const needsItem = form.type !== "mushaf";
  const chosen = form.ids[form.type];
  const id = needsItem ? (items.some((x) => x.id === chosen) ? chosen! : (items[0]?.id ?? "")) : "";

  const [from, to] = form.scope === "whole" ? [1, 114] : form.scope === "one" ? [form.from, form.from] : [Math.min(form.from, form.to), Math.max(form.from, form.to)];
  const ayat = surahs.filter((s) => s.number >= from && s.number <= to).reduce((n, s) => n + s.numberOfAyahs, 0);
  const count = to - from + 1;
  const hint =
    form.type === "recitation"
      ? t("dlCountAyat", { n: ayat.toLocaleString(lang), surahs: count })
      : form.type === "mushaf"
        ? form.scope === "whole"
          ? t("mushafWholeHint", { n: MUSHAF_PAGES })
          : t("mushafSurahHint")
        : t("dlCountSurahs", { n: count });

  const surahOptions = surahs.map((s) => (
    <option key={s.number} value={s.number}>
      {lang === "ar" ? `${localDigits(s.number, lang)}. ${s.name}` : `${s.number}. ${s.englishName} — ${s.name}`}
    </option>
  ));

  const grouped =
    form.type === "recitation"
      ? groupBy(items, (r) => (r.hasWordTimings ? t("recitersTimed") : t("recitersOther")))
      : groupBy(items, (x) => languageName(x.language, lang));

  return (
    <section className="dl-card" ref={ref}>
      <h2>{t("downloadForOffline")}</h2>
      <div className="fields">
        <Field label={t("whatToDownload")}>
          <Segmented<Kind> label={t("whatToDownload")} value={form.type} onChange={(type) => setForm({ ...form, type })} options={KINDS.map((k) => ({ value: k, label: t(`dl_${k}`) }))} />
        </Field>
        {needsItem ? (
          <Field label={t(form.type === "recitation" ? "reciter" : form.type)}>
            <Select value={id} onChange={(e) => setForm({ ...form, ids: { ...form.ids, [form.type]: e.target.value } })}>
              {grouped.map(([group, list]) => (
                <optgroup key={group} label={group}>
                  {list.map((x) => (
                    <option key={x.id} value={x.id}>
                      {(lang === "ar" && x.nameAr) || x.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label={t("whichSurahs")}>
          <Segmented<Scope>
            label={t("whichSurahs")}
            value={form.scope}
            onChange={(scope) => setForm({ ...form, scope })}
            options={[
              { value: "one", label: t("oneSurah") },
              { value: "range", label: t("surahRange") },
              { value: "whole", label: t("wholeQuran") },
            ]}
          />
        </Field>
        {form.scope === "one" ? (
          <Field label={t("surah")}>
            <Select value={form.from} onChange={(e) => setForm({ ...form, from: Number(e.target.value) })}>
              {surahOptions}
            </Select>
          </Field>
        ) : null}
        {form.scope === "range" ? (
          <div className="pair">
            <Field label={t("from")}>
              <Select value={form.from} onChange={(e) => setForm({ ...form, from: Number(e.target.value) })}>
                {surahOptions}
              </Select>
            </Field>
            <Field label={t("to")}>
              <Select value={form.to} onChange={(e) => setForm({ ...form, to: Number(e.target.value) })}>
                {surahOptions}
              </Select>
            </Field>
          </div>
        ) : null}
        <div className="dl-submit">
          <span className="field-hint">{hint}</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={needsItem && !id}
            onClick={() => onSubmit({ type: form.type, id: needsItem ? id : undefined, surahFrom: from, surahTo: to })}
          >
            <Icon name="download" size={18} />
            {t("startDownload")}
          </button>
        </div>
      </div>
    </section>
  );
}

function TaskRow({
  task,
  title,
  scope,
  onCancel,
  onRetry,
}: {
  task: DownloadTask;
  title: string;
  scope: string;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  const isActive = ACTIVE.has(task.status);
  const unit = task.type === "recitation" ? "progressAyat" : task.type === "mushaf" ? "progressPages" : "progressSurahs";
  const pct = task.total ? Math.round((task.done / task.total) * 100) : 0;
  const n = (v: number) => v.toLocaleString(i18n.language);
  return (
    <li className="list-item">
      <div className="list-main">
        <div className="lib-title">
          <span className="file-key">{title}</span>
          <span className="surah-meta">
            {t(`dl_${task.type}`)} · {scope}
          </span>
        </div>
        <span className="surah-meta">
          <span className={`status s-${task.status === "running" ? "rendering" : task.status}`}>{t(`dlStatus_${task.status}`)}</span>
          {task.total ? <> · {t(unit, { done: n(task.done), total: n(task.total) })}</> : task.status === "running" ? <> · {t("preparing")}</> : null}
        </span>
        {isActive ? (
          <span className="progress">
            <span style={{ width: `${pct}%` }} />
          </span>
        ) : null}
        {task.failed && !isActive ? (
          <p className="notice warn">
            {t("someFailed", { n: task.failed })}
            {task.error ? <span className="dl-error"> ({task.error})</span> : null}
          </p>
        ) : null}
      </div>
      <div className="list-actions">
        {!isActive && (task.failed || task.status === "failed") ? (
          <button type="button" className="btn btn-quiet" aria-label={t("retry")} onClick={onRetry}>
            <Icon name="retry" size={18} />
            <span className="label-wide">{t("retry")}</span>
          </button>
        ) : null}
        <button type="button" className="btn btn-quiet" aria-label={isActive ? t("cancel") : t("close")} onClick={onCancel}>
          {isActive ? t("cancel") : <Icon name="close" size={18} />}
        </button>
      </div>
    </li>
  );
}

function GroupRow({
  group: g,
  title,
  subtitle,
  surahName,
  onDelete,
  onFinish,
  onMore,
}: {
  group: LibraryGroup;
  title: string;
  subtitle?: string;
  surahName: (n: number) => string;
  onDelete: (surah?: number) => void;
  onFinish: (surah: number) => void;
  onMore?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const n = (v: number) => localDigits(v, lang);
  const full = g.surahs.filter((s) => s.have >= s.total).length;
  const partial = g.surahs.length - full;

  const summary = [
    g.type === "recitation" ? [full ? t("surahsComplete", { n: n(full) }) : "", partial ? t("surahsPartial", { n: n(partial) }) : ""].filter(Boolean).join(" · ") : "",
    g.type === "mushaf" ? t("pagesSaved", { n: n(g.pages.length), total: n(MUSHAF_PAGES) }) : "",
    g.type === "tafsir" || g.type === "translation" || g.type === "text" ? t("surahsSaved", { n: n(g.surahs.length) }) : "",
    g.type === "backgrounds" ? t("bgCount", { n: n(g.files) }) : "",
    formatBytes(g.bytes),
  ]
    .filter(Boolean)
    .join(" · ");

  const expandable = g.surahs.length > 0 || g.pages.length > 0;

  return (
    <li className="list-item lib-group">
      <details className="list-main">
        <summary className={expandable ? "" : "no-expand"}>
          <span className="lib-title">
            <span className="file-key" dir="auto">
              {title}
              {subtitle ? <span className="lib-lang">{subtitle}</span> : null}
            </span>
            <span className="surah-meta">{summary}</span>
          </span>
        </summary>
        {g.pages.length ? <p className="surah-meta lib-pages">{t("pagesList", { list: pageRanges(g.pages) })}</p> : null}
        {g.surahs.length ? (
          <ul className="lib-rows">
            {g.surahs.map((s) => {
              const done = s.have >= s.total;
              return (
                <li key={s.surah}>
                  <span className="lib-row-name">
                    <span className="lib-num">{n(s.surah)}</span>
                    {surahName(s.surah)}
                  </span>
                  <span className="surah-meta">
                    {g.type === "recitation" ? (done ? t("complete") : t("ayatOf", { have: n(s.have), total: n(s.total) })) : null}
                    {g.type === "recitation" ? " · " : null}
                    {formatBytes(s.bytes)}
                  </span>
                  <span className="lib-row-actions">
                    {g.type === "recitation" && !done ? (
                      <button type="button" className="btn btn-quiet btn-sm" onClick={() => onFinish(s.surah)}>
                        <Icon name="download" size={16} />
                        {t("finish")}
                      </button>
                    ) : null}
                    {g.type === "recitation" && done ? (
                      <span className="lib-check" aria-label={t("complete")}>
                        <Icon name="check" size={18} />
                      </span>
                    ) : null}
                    <button type="button" className="btn btn-quiet btn-sm danger" aria-label={t("delete")} onClick={() => onDelete(s.surah)}>
                      <Icon name="trash" size={16} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="lib-group-actions">
          {onMore ? (
            <button type="button" className="btn btn-quiet btn-sm" onClick={onMore}>
              <Icon name="download" size={16} />
              {t("downloadMore")}
            </button>
          ) : null}
          <button type="button" className="btn btn-quiet btn-sm danger" onClick={() => onDelete()}>
            <Icon name="trash" size={16} />
            {t("deleteAll")}
          </button>
        </div>
      </details>
      {!expandable ? (
        <div className="list-actions">
          <button type="button" className="btn btn-quiet danger" aria-label={g.type === "app" ? t("clear") : t("delete")} onClick={() => onDelete()}>
            <Icon name="trash" size={18} />
            <span className="label-wide">{g.type === "app" ? t("clear") : t("delete")}</span>
          </button>
        </div>
      ) : null}
    </li>
  );
}
