import { FileText } from "lucide-react";

type Props = {
  onOpenSearch: () => void;
};

/**
 * Renders the canvas toolbar entry that delegates Markdown lookup to KiwiFS search.
 * 마크다운 찾기는 KiwiFS 기본 검색창에 맡기는 캔버스 툴바 항목을 렌더링합니다.
 *
 * @param props - Search-opening callback owned by FlowCanvas.
 * @returns A menu button that opens native Markdown page search.
 */
export function CanvasMarkdownPagePicker({ onOpenSearch }: Props) {
  return (
    <button
      className="w-full px-3 py-1.5 text-left text-sm rounded hover:bg-accent flex items-center gap-2"
      onClick={onOpenSearch}
    >
      <FileText className="h-3.5 w-3.5" /> Markdown page
    </button>
  );
}
