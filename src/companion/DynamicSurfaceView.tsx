import { useState } from "react";
import type { DynamicSurface, SurfaceBlock } from "../../electron/companionContract";

function Comparison({ block }: { block: Extract<SurfaceBlock, { kind: "comparison" }> }) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<number | null>(null);
  const rows = block.rows.filter(row => row.cells.join(" ").toLowerCase().includes(filter.toLowerCase()));
  if (sort !== null) rows.sort((a, b) => a.cells[sort].localeCompare(b.cells[sort], undefined, { numeric: true }));
  return <>
    <input aria-label={`Filter ${block.title}`} placeholder="Filter options…" value={filter} onChange={event => setFilter(event.target.value)} />
    <div className="qc-table"><table><thead><tr>{block.columns.map((column, index) => <th key={index}><button onClick={() => setSort(index)} aria-label={`Sort by ${column}`}>{column}{sort === index ? " ↑" : ""}</button></th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}>{row.cells.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div>
  </>;
}
export function DynamicSurfaceView({ surface, run }: { surface: DynamicSurface; run: (work: () => Promise<unknown>) => void }) {
  const [edits, setEdits] = useState<Record<string, string | boolean>>({});
  const value = (key: string, fallback: string | boolean) => edits[key] ?? surface.values[key] ?? fallback;
  const update = (key: string, next: string | boolean) => {
    setEdits(previous => ({ ...previous, [key]: next }));
    run(() => window.companion.updateValue({ surfaceId: surface.id, key, value: next }));
  };
  return <article className="qc-surface" aria-label={surface.title}>
    <header><div><span className="qc-eyebrow">Made for this task</span><h2>{surface.title}</h2></div><button aria-pressed={surface.pinned} onClick={() => run(() => window.companion.retainSurface(surface.id, { pinned: !surface.pinned, saved: surface.saved }))}>{surface.pinned ? "Unpin" : "Pin"}</button></header>
    {surface.answer && <p className="qc-answer">{surface.answer}</p>}
    {surface.blocks.map(block => <section className="qc-block" key={block.id} aria-label={block.title}>
      <h3>{block.title}</h3>
      {block.kind === "draft" && <textarea aria-label={block.title} rows={7} value={String(value(block.id, block.text))} onChange={event => update(block.id, event.target.value)} />}
      {block.kind === "form" && block.fields.map(field => <label key={field.id}>{field.label}<input value={String(value(`${block.id}:${field.id}`, field.value))} onChange={event => update(`${block.id}:${field.id}`, event.target.value)} /></label>)}
      {block.kind === "comparison" && <Comparison block={block} />}
      {block.kind === "checklist" && block.items.map(item => <label className="qc-check" key={item.id}><input type="checkbox" checked={Boolean(value(`${block.id}:${item.id}`, item.checked))} onChange={event => update(`${block.id}:${item.id}`, event.target.checked)} /><span>{item.text}</span></label>)}
      {block.kind === "sources" && block.items.map((item, index) => <blockquote key={index}><strong>{item.label}</strong><p>{item.excerpt}</p></blockquote>)}
      {block.kind === "progress" && <p role="status">{block.text}</p>}
    </section>)}
    <footer className="qc-actions">
      <button onClick={() => run(() => window.companion.surfaceCommand(surface.id, "copy"))}>Copy work</button>
      <button onClick={() => run(() => window.companion.surfaceCommand(surface.id, "refine"))}>Refine with my edits</button>
      <button aria-pressed={surface.saved} onClick={() => run(() => window.companion.retainSurface(surface.id, { saved: !surface.saved, pinned: surface.pinned }))}>{surface.saved ? "Saved interface" : "Save interface"}</button>
      <button onClick={() => run(() => window.companion.surfaceCommand(surface.id, "save-note"))}>Save as note</button>
    </footer>
  </article>;
}
