// Applies the link constants from the top of index.html. Nothing else.
// No analytics, no cookies, no network requests.

type Links = { GITHUB_URL: string; DEMO_VIDEO_URL: string; SOCIAL_POST_URL: string };

const links: Links = (window as unknown as { GAZEWISE_LINKS?: Links }).GAZEWISE_LINKS ?? {
  GITHUB_URL: "https://github.com/",
  DEMO_VIDEO_URL: "",
  SOCIAL_POST_URL: "",
};

const github = links.GITHUB_URL.trim().replace(/\/+$/, "");
const isRepo = /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(github);

function setHref(key: string, href: string): void {
  document.querySelectorAll<HTMLAnchorElement>(`a[data-link="${key}"]`).forEach((a) => {
    a.href = href;
  });
}

if (isRepo) {
  setHref("github", github);
  setHref("readme", `${github}#readme`);
  setHref("license", `${github}/blob/main/LICENSE`);
  document.querySelectorAll('[data-text="clone"]').forEach((el) => {
    el.textContent = `${github}.git`;
  });
}

const social = links.SOCIAL_POST_URL.trim();
if (social) {
  setHref("social", social);
  document.querySelector<HTMLElement>('a[data-link="social"]')?.removeAttribute("hidden");
  document.querySelector<HTMLElement>('[data-social="placeholder"]')?.setAttribute("hidden", "");
}

const demo = links.DEMO_VIDEO_URL.trim();
if (demo) {
  setHref("demo", demo);
  const ready = document.querySelector<HTMLElement>('[data-demo="ready"]');
  const placeholder = document.querySelector<HTMLElement>('[data-demo="placeholder"]');
  if (ready && placeholder) {
    const embed = youTubeEmbed(demo);
    if (embed) {
      const frame = document.createElement("iframe");
      frame.src = embed;
      frame.title = "Gazewise demo video";
      frame.loading = "lazy";
      frame.allow = "encrypted-media; picture-in-picture; fullscreen";
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.className = "w-full aspect-video rounded-2xl border border-line";
      ready.append(frame);
    }
    const p = document.createElement("p");
    p.className = embed ? "mt-3 text-sm" : "";
    const a = document.createElement("a");
    a.href = demo;
    a.rel = "noopener";
    a.className = embed ? "link" : "btn btn-primary";
    a.textContent = embed ? "Open the demo video in a new tab" : "Watch the demo video";
    a.target = "_blank";
    p.append(a);
    ready.append(p);
    ready.hidden = false;
    placeholder.hidden = true;
  }
}

/** youtube.com/watch?v=ID or youtu.be/ID → privacy-enhanced embed URL; anything else → null (link only). */
function youTubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    let id: string | null = null;
    if (u.hostname === "youtu.be") id = u.pathname.slice(1);
    else if (u.hostname.endsWith("youtube.com")) id = u.searchParams.get("v") ?? u.pathname.split("/").pop() ?? null;
    return id && /^[\w-]{6,}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  } catch {
    return null;
  }
}
