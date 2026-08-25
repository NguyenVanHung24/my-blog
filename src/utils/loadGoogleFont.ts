async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadGoogleFont(
  font: string,
  text: string,
  weight: number
): Promise<ArrayBuffer> {
  const API = `https://fonts.googleapis.com/css2?family=${font}:wght@${weight}&text=${encodeURIComponent(text)}`;

  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await sleep(backoffMs);
      }

      const css = await (
        await fetch(API, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1",
          },
        })
      ).text();

      const resource = css.match(
        /src: url\((.+?)\) format\('(opentype|truetype)'\)/
      );

      if (!resource) throw new Error("Failed to parse font CSS");

      const res = await fetch(resource[1]);

      if (!res.ok) {
        throw new Error("Failed to download font file. Status: " + res.status);
      }

      return res.arrayBuffer();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `Font loading attempt ${attempt + 1}/${maxRetries} failed for ${font}:`,
        lastError.message
      );
    }
  }

  throw new Error(
    `Failed to download dynamic font after ${maxRetries} attempts. Last error: ${lastError?.message}`
  );
}

async function loadGoogleFonts(
  text: string
): Promise<
  Array<{ name: string; data: ArrayBuffer; weight: number; style: string }>
> {
  const fontsConfig = [
    {
      name: "IBM Plex Mono",
      font: "IBM+Plex+Mono",
      weight: 400,
      style: "normal",
    },
    {
      name: "IBM Plex Mono",
      font: "IBM+Plex+Mono",
      weight: 700,
      style: "bold",
    },
  ];

  const fonts = await Promise.all(
    fontsConfig.map(async ({ name, font, weight, style }) => {
      const data = await loadGoogleFont(font, text, weight);
      return { name, data, weight, style };
    })
  );

  return fonts;
}

export default loadGoogleFonts;
