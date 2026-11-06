# AutoAyah (MVP)

Make vertical (1080×1920) Quran clips: pick a surah, an ayah range, a reciter and an optional Arabic tafsir, preview the clip in the browser, then render an MP4.

Text and tafsir come from [AlQuran.cloud](https://alquran.cloud/api), audio from [everyayah.com](https://everyayah.com). Video is made with [Remotion](https://remotion.dev).

## Run with Docker

```sh
docker compose up --build
```

Open http://localhost:3737. Rendered videos are saved to `./out`.

## Local dev

```sh
npm install
npm run dev        # API on :3737, Vite UI on :5173 (set PORT to change the API port)
```

Production-style run without Docker:

```sh
npm run build && npm start   # http://localhost:3737
```

The first start downloads Chrome Headless Shell (~140 MB) for rendering.
