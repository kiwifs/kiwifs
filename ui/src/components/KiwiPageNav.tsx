import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api, getSpaceEpoch } from "@kw/lib/api";
import {
  pageDescriptionFromMarkdown,
  pageTitleFromMarkdown,
  type BookNav,
  type BookOrder,
} from "@kw/lib/bookOrder";

type Props = {
  nav: BookNav;
  order?: BookOrder;
  onNavigate: (path: string) => void;
};

export function KiwiPageNav({ nav, onNavigate }: Props) {
  const preview = nav.next ?? nav.prev;
  const [read, setRead] = useState<{ title: string; description: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRead(null);
    if (!preview) return;
    const epoch = getSpaceEpoch();
    api
      .readFile(preview.path)
      .then(({ content }) => {
        if (cancelled || getSpaceEpoch() !== epoch) return;
        setRead({
          title: pageTitleFromMarkdown(content),
          description: pageDescriptionFromMarkdown(content),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [preview?.path]);

  if (!preview) return null;

  const title = read?.title || preview.title;
  const description = preview.description || read?.description || "";
  const hasPrev = Boolean(nav.prev);
  const hasNext = Boolean(nav.next);
  const align = hasPrev && hasNext ? "is-center" : hasNext ? "is-end" : "is-start";
  const railTitle = (page: { path: string; title: string }) =>
    page.path === preview.path ? title : page.title;

  return (
    <nav className="kiwi-page-nav" aria-label="Reading order">
      <div className={`kiwi-page-nav-pill ${align}`}>
        {nav.prev && (
          <button
            type="button"
            className="kiwi-page-nav-rail is-prev"
            onClick={() => onNavigate(nav.prev!.path)}
            aria-label={`Previous: ${railTitle(nav.prev)}`}
          >
            <ChevronLeft className="kiwi-page-nav-chevron" strokeWidth={2} aria-hidden="true" />
            <span>Previous</span>
          </button>
        )}

        <div className="kiwi-page-nav-forward">
          <button
            type="button"
            className="kiwi-page-nav-preview"
            onClick={() => onNavigate(preview.path)}
            aria-label={`${hasNext ? "Next" : "Previous"}: ${title}`}
          >
            <span className="kiwi-page-nav-title">{title}</span>
            {description ? <span className="kiwi-page-nav-desc">{description}</span> : null}
          </button>

          {nav.next && (
            <button
              type="button"
              className="kiwi-page-nav-rail is-next"
              onClick={() => onNavigate(nav.next!.path)}
              aria-label={`Next: ${railTitle(nav.next)}`}
            >
              <span>Next</span>
              <ChevronRight className="kiwi-page-nav-chevron" strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
