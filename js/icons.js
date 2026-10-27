// Иконки интерфейса и погоды (inline SVG, рисуются цветом текста).

const P = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  layers: '<path d="m12 3.5 8.5 4.7L12 13 3.5 8.2 12 3.5Z"/><path d="m3.5 12.4 8.5 4.8 8.5-4.8"/><path d="m3.5 16.3 8.5 4.7 8.5-4.7"/>',
  locate: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3"/>',
  pin: '<path d="M12 21.5s-6.8-6.3-6.8-11.6a6.8 6.8 0 0 1 13.6 0c0 5.3-6.8 11.6-6.8 11.6Z"/><circle cx="12" cy="9.8" r="2.4"/>',
  map: '<path d="M9 4.5 3.5 6.8v12.7L9 17.2l6 2.3 5.5-2.3V4.5L15 6.8 9 4.5Z"/><path d="M9 4.5v12.7M15 6.8v12.7"/>',
  spots: '<path d="M12 2.5v3.2"/><path d="M12 5.7c3.1 0 5.3 3 5.3 7.4H6.7c0-4.4 2.2-7.4 5.3-7.4Z" fill="currentColor" fill-opacity=".18"/><path d="M6.7 13.1h10.6c0 3.4-2.4 5.9-5.3 5.9s-5.3-2.5-5.3-5.9Z"/><path d="M12 19v2.5"/>',
  book: '<path d="M5 4.5h10.5A3.5 3.5 0 0 1 19 8v12H8.5A3.5 3.5 0 0 1 5 16.5v-12Z"/><path d="M5 16.5A3.5 3.5 0 0 1 8.5 13H19"/><path d="M9 8.3h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="m14.5 5-7 7 7 7"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  camera: '<path d="M3.5 8.2h3.4l1.8-2.7h6.6l1.8 2.7h3.4v11H3.5v-11Z"/><circle cx="12" cy="13.5" r="3.4"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.9 12.5h9.2L17.5 7M9.3 7V4.5h5.4V7"/>',
  edit: '<path d="M4.5 19.5h3.8L19 8.8 15.2 5 4.5 15.7v3.8Z"/><path d="m13.3 6.9 3.8 3.8"/>',
  route: '<path d="M4 11.2 20 4l-7.2 16-1.9-6.9L4 11.2Z"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  download: '<path d="M12 4v11m0 0-4.2-4.2M12 15l4.2-4.2M5 19.5h14"/>',
  upload: '<path d="M12 19.5v-11m0 0-4.2 4.2M12 8.5l4.2 4.2M5 4.5h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4.9a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.4A7.6 7.6 0 0 0 7 6.4l-2.4-.9-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-.9a7.6 7.6 0 0 0 2.6 1.5l.4 2.4h4l.4-2.4a7.6 7.6 0 0 0 2.6-1.5l2.4.9 2-3.4-2-1.6Z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  fish: '<path d="M2.8 12c3-4.4 8.8-5.8 13.6-2.4L21 6.2v11.6l-4.6-3.4C11.6 17.8 5.8 16.4 2.8 12Z"/><circle cx="8" cy="11.2" r="1" fill="currentColor" stroke="none"/>',
  chevron: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  refresh: '<path d="M19.5 11.5A7.5 7.5 0 1 1 17.3 6.2"/><path d="M19.5 4v5h-5"/>',
  dots: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  wifiOff: '<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4.2-2.4M14.8 10.5A10 10 0 0 1 19 12.9M2 9.3a15 15 0 0 1 4-2.5M11 5.6a15 15 0 0 1 11 3.7"/><circle cx="12" cy="20" r=".8" fill="currentColor"/>',
  depth: '<path d="M2.5 6.5c1.6-1.3 3.2-1.3 4.8 0s3.2 1.3 4.7 0 3.2-1.3 4.8 0 3.1 1.3 4.7 0"/><path d="M5 11.5h14M7 15.5h10M9.5 19.5h5"/>',
  share: '<path d="M12 15V3.8m0 0L8 7.8m4-4 4 4"/><path d="M5.5 11v8.5h13V11"/>',
};

export function icon(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
}

const CLOUD_HI = '<path d="M7 14h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14Z"/>';
const W = {
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"/>',
  partly: '<path d="M8.5 2.8v1.6M3.3 8h1.6M4.9 4.4l1.1 1.1M12.1 4.4 11 5.5"/><path d="M5.6 11.1A3.6 3.6 0 1 1 11.9 7.3"/><path d="M8.6 20.5h8.6a3.9 3.9 0 0 0 .4-7.8 5.4 5.4 0 0 0-10.4 1.4 3.2 3.2 0 0 0 1.4 6.4Z"/>',
  cloud: '<path d="M7 19h10a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6 1.8A3.7 3.7 0 0 0 7 19Z"/>',
  fog: CLOUD_HI + '<path d="M4 17.5h16M6.5 21h11"/>',
  drizzle: CLOUD_HI + '<path d="M8.5 17.5v.5M12 18.5v.5M15.5 17.5v.5M10 21v.5M14 21v.5"/>',
  rain: CLOUD_HI + '<path d="m9 17-1.2 3.5M13 17l-1.2 3.5M17 17l-1.2 3.5"/>',
  snow: CLOUD_HI + '<path d="M8.5 17.6v.1M12 19.2v.1M15.5 17.6v.1M10.2 21.3v.1M13.8 21.3v.1" stroke-width="2.6"/>',
  storm: CLOUD_HI + '<path d="m12.6 14.8-2.4 3.7h3.6l-2.2 3.7"/>',
};
export function wxIcon(name, cls = '') {
  return `<svg class="i wi ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${W[name] || W.cloud}</svg>`;
}

// Стрелка показывает, куда дует ветер (метео-направление — откуда).
export function windArrow(deg, cls = '') {
  if (deg == null) return '';
  return `<svg class="i warrow ${cls}" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${Math.round(deg + 180)}deg)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V4.5M12 4.5l-4.5 5M12 4.5l4.5 5"/></svg>`;
}

// Поплавок — метка места на карте и в списках.
export function floatSVG(cls = '') {
  return `<svg class="float ${cls}" viewBox="0 0 28 40" aria-hidden="true"><path class="pf-ant" d="M14 1.8V8.6"/><path class="pf-top" d="M14 8.2c4.5 0 7.8 4.6 7.8 11.3H6.2C6.2 12.8 9.5 8.2 14 8.2Z"/><path class="pf-bot" d="M6.2 19.5h15.6c0 5.3-3.5 9.3-7.8 9.3s-7.8-4-7.8-9.3Z"/><path class="pf-line" d="M14 8.2c4.5 0 7.8 4.6 7.8 11.3s-3.5 9.3-7.8 9.3-7.8-4-7.8-9.3S9.5 8.2 14 8.2Z"/><path class="pf-ant" d="M14 28.8v8.4"/></svg>`;
}
