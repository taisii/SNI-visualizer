const DEFAULT_CODE = `# ptr++ ループ（デモ用）
start:
  load r1, [ptr]
  add  ptr, 1
  beqz r1, end
  jmp  start
end:
  ret`;

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
