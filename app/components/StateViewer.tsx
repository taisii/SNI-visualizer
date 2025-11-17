import type { AbstractState, StateSection } from "../types/analysis-result";

type Props = {
  state: AbstractState | null;
};

const badgeColors: Record<StateSection["data"][string]["style"], string> = {
  neutral: "bg-neutral-200 text-neutral-800",
  safe: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  info: "bg-blue-100 text-blue-800",
};

export function StateViewer({ state }: Props) {
  if (!state) {
    return (
      <div className="flex h-full items-center justify-center rounded border border-dashed border-neutral-200 bg-white text-sm text-neutral-500">
        ステート情報がここに表示されます
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 rounded border border-neutral-200 bg-white p-3">
      <div className="text-sm font-semibold text-neutral-800">抽象状態</div>
      <div className="space-y-3">
        {state.sections.map((section) => (
          <div
            key={section.id}
            className={`rounded border p-2 ${
              section.alert ? "border-red-200 bg-red-50" : "border-neutral-200 bg-neutral-50"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-neutral-800">{section.title}</div>
              {section.alert && <span className="text-xs font-semibold text-red-700">ALERT</span>}
            </div>
            {section.description && <p className="mt-1 text-xs text-neutral-600">{section.description}</p>}
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-neutral-800">
              {Object.entries(section.data).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between rounded bg-white px-2 py-1">
                  <span className="font-mono text-[11px] text-neutral-700">{key}</span>
                  <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${badgeColors[value.style]}`}>
                    {value.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
