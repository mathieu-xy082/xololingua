const DEFAULT_BASE_URL = "http://127.0.0.1:8765";

export function createBackendClient({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  FormDataImpl = globalThis.FormData,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("createBackendClient requires a fetch implementation.");
  }
  if (typeof FormDataImpl !== "function") {
    throw new TypeError("createBackendClient requires a FormData implementation.");
  }

  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, "");
  const endpoint = (path) => `${normalizedBaseUrl}${path}`;

  async function readJson(response, fallbackError) {
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(fallbackError);
    }
    if (!response.ok) {
      throw new Error(payload.error || fallbackError);
    }
    return payload;
  }

  return {
    async getHealth() {
      const response = await fetchImpl(endpoint("/api/health"));
      return readJson(response, "Local service health could not be read.");
    },

    async getTranslationPairs() {
      const response = await fetchImpl(endpoint("/api/translation-pairs"));
      const payload = await readJson(response, "Translation pairs could not be read.");
      return payload.pairs || [];
    },

    async extractAudio(file, onProgress = () => {}) {
      onProgress(5);

      const health = await fetchImpl(endpoint("/api/health"));
      if (!health.ok) {
        throw new Error("Local audio service is not available.");
      }

      const formData = new FormDataImpl();
      formData.append("video", file, file.name);
      onProgress(15);

      const response = await fetchImpl(endpoint("/api/extract-audio"), {
        method: "POST",
        body: formData,
      });
      const payload = await readJson(response, "Audio extraction failed.");

      onProgress(35);
      return payload;
    },

    async segmentAudio(audioId, onProgress = () => {}) {
      onProgress(10);

      const response = await fetchImpl(endpoint("/api/segment-audio"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ audioId }),
      });
      const payload = await readJson(response, "Audio segmentation failed.");

      onProgress(100);
      return payload.segments;
    },

    async createSubtitleJob({ extractedAudio, sourceLanguage, targetLanguage, segments }) {
      const response = await fetchImpl(endpoint("/api/subtitle-jobs"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audioId: extractedAudio.audioId,
          sourceLanguage: sourceLanguage.code,
          targetLanguage,
          segments,
        }),
      });
      return readJson(response, "Subtitle generation job could not start.");
    },

    async getSubtitleJob(jobId) {
      const response = await fetchImpl(endpoint(`/api/subtitle-jobs/${jobId}`));
      return readJson(response, "Subtitle generation job could not be read.");
    },

    async cancelSubtitleJob(jobId) {
      const response = await fetchImpl(endpoint(`/api/subtitle-jobs/${jobId}/cancel`), {
        method: "POST",
      });
      return readJson(response, "Subtitle generation job could not be cancelled.");
    },
  };
}
