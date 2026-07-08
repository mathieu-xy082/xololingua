export function formatSrt(segments) {
  const blocks = segments.map((segment, offset) => [
    String(segment.index ?? offset + 1),
    `${formatSrtTime(segment.start)} --> ${formatSrtTime(segment.end)}`,
    segment.translatedText || segment.text || "",
  ].join("\n"));

  return `${blocks.join("\n\n")}\n`;
}

export function formatSrtTime(seconds) {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const milliseconds = totalMilliseconds % 1000;
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(remainingSeconds).padStart(2, "0"),
  ].join(":") + `,${String(milliseconds).padStart(3, "0")}`;
}
