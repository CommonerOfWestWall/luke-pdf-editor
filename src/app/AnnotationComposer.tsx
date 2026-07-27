import { useState } from "react";
import type { AnnotationRecord } from "../pdf/contracts";
import { annotationKindLabel } from "./annotation-panel";

export function AnnotationComposer({
  annotation,
  selectionText,
  onCancel,
  onSubmit,
}: {
  annotation: AnnotationRecord;
  selectionText?: string;
  onCancel: () => void;
  onSubmit: (contents: string) => void;
}) {
  const [contents, setContents] = useState(annotation.contents);
  const requiresContents = annotation.kind === "note" || annotation.kind === "freeText";

  return (
    <form
      className="annotation-composer"
      aria-labelledby="annotation-composer-title"
      onSubmit={(event) => {
        event.preventDefault();
        if (requiresContents && !contents.trim()) return;
        onSubmit(contents.trim());
      }}
    >
      <header>
        <div>
          <span>放置位置已确定</span>
          <h2 id="annotation-composer-title">新建{annotationKindLabel(annotation.kind)}</h2>
        </div>
        <button type="button" aria-label="取消创建批注" onClick={onCancel}>×</button>
      </header>
      {selectionText && (
        <blockquote>
          <span>已选择文字</span>
          <p>{selectionText}</p>
        </blockquote>
      )}
      <label htmlFor="new-annotation-contents">
        {annotation.kind === "freeText" ? "文本框内容" : "便签内容"}
        <textarea
          id="new-annotation-contents"
          value={contents}
          placeholder="输入要写入 PDF 的文字…"
          onChange={(event) => setContents(event.target.value)}
        />
      </label>
      <p className="annotation-composer-hint">
        编辑区留在侧栏，不遮挡原稿；按 Esc 可取消本次放置。
      </p>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>取消</button>
        <button className="primary-button" type="submit" disabled={requiresContents && !contents.trim()}>
          创建批注
        </button>
      </div>
    </form>
  );
}
