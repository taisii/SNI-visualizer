const DEFAULT_CODE = `Loop:
  load z, a
  load a, c
  beqz y, Loop`;

type Props = {
  value: string;
  onChange: (next: string) => void;
};

export function CodeEditor({ value, onChange }: Props) {
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-800">MuASM コード</h2>
        <button
          className="text-xs text-blue-600 underline"
          type="button"
          onClick={() => onChange(DEFAULT_CODE)}
        >
          デモコードをリセット
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-[280px] w-full resize-none rounded border border-neutral-300 bg-white p-3 font-mono text-sm text-neutral-900 focus:border-blue-500 focus:outline-none"
        spellCheck={false}
      />
    </div>
  );
}

export function createInitialSource() {
  return DEFAULT_CODE;
}
