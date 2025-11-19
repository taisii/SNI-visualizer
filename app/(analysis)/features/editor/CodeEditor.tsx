import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

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
    <Accordion
      type="single"
      collapsible
      defaultValue="code-editor"
      className="rounded-lg border border-neutral-200 bg-white shadow-sm"
    >
      <AccordionItem value="code-editor" className="border-none">
        <AccordionTrigger className="px-4 py-3 text-sm font-semibold text-neutral-800 hover:no-underline">
          MuASM コード
        </AccordionTrigger>
        <AccordionContent className="px-4 pb-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs text-neutral-600">
              解析対象の MuASM ソースを編集してください。
            </p>
            <button
              className="text-xs font-semibold text-blue-600 underline"
              type="button"
              onClick={() => onChange(DEFAULT_CODE)}
            >
              コードをリセット
            </button>
          </div>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-[280px] w-full resize-none rounded border border-neutral-300 bg-white p-3 font-mono text-sm text-neutral-900 focus:border-blue-500 focus:outline-none"
            spellCheck={false}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function createInitialSource() {
  return DEFAULT_CODE;
}
