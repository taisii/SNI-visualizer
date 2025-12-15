import { useEffect, useState } from "react";
import { getTestCases, type TestCase, type TestCategory } from "@/app/actions/test-cases";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { BookOpen, AlertTriangle, CheckCircle, ArrowRight, Loader2 } from "lucide-react";
import { analyze } from "@/app/(analysis)/features/analysis-runner/services/analyze";
import { badgeStyles } from "@/app/(analysis)/shared/Header";

type TestCaseLibraryProps = {
  onSelect: (content: string) => void;
};

type AnalysisStatus = "Secure" | "SNI_Violation" | "Error" | "Loading" | "Pending";

export function TestCaseLibrary({ onSelect }: TestCaseLibraryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [categories, setCategories] = useState<TestCategory[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<Record<string, AnalysisStatus>>({});

  useEffect(() => {
    if (isOpen && categories.length === 0) {
      loadCasesAndAnalyze();
    }
  }, [isOpen]);

  const loadCasesAndAnalyze = async () => {
    setIsLoading(true);
    try {
      const data = await getTestCases();
      setCategories(data);
      
      // Initialize results as Loading
      const initialResults: Record<string, AnalysisStatus> = {};
      const allCases: TestCase[] = [];
      data.forEach(cat => cat.cases.forEach(c => {
        initialResults[c.id] = "Loading";
        allCases.push(c);
      }));
      setResults(initialResults);

      setIsLoading(false); // UI rendering can start

      // Run analysis in background
      // Analyze individually to update UI incrementally
      for (const testCase of allCases) {
        try {
          const res = await analyze(testCase.content, { traceMode: "bfs", specWindow: 20 });
          setResults(prev => ({
            ...prev,
            [testCase.id]: res.error ? "Error" : (res.result || "Error")
          }));
        } catch (e) {
          setResults(prev => ({
            ...prev,
            [testCase.id]: "Error"
          }));
        }
        // Small delay to yield to UI thread if needed, though await analyze is async
        await new Promise(r => setTimeout(r, 0));
      }

    } catch (e) {
      toast.error("テストケースの読み込みに失敗しました");
      setIsLoading(false);
    }
  };

  const handleSelect = (code: string) => {
    onSelect(code);
    setIsOpen(false);
    toast.success("テストコードを読み込みました");
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 shadow-sm border border-neutral-200 hover:bg-neutral-50 transition-colors"
        >
          <BookOpen className="h-4 w-4" />
          Golden Set
        </button>
      </DialogTrigger>
      <DialogContent className="w-[90vw] max-w-none h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5" />
            ゴールデンテストセット
          </DialogTitle>
          <DialogDescription>
            検証済みのテストケースセット（Golden Set）を実行・確認できます。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 bg-neutral-50/50">
          {isLoading && categories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-500 gap-2">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p>Loading test cases...</p>
            </div>
          ) : (
            <Accordion type="multiple" className="w-full space-y-4" defaultValue={categories.map(c => c.name)}>
              {categories.map((cat) => (
                <AccordionItem key={cat.name} value={cat.name} className="border-none">
                  <AccordionTrigger className="text-base font-semibold px-2 hover:no-underline">
                    <span className="capitalize flex items-center gap-2">
                      {cat.name}
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-normal text-neutral-600">
                        {cat.cases.length}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid grid-cols-1 gap-2 p-1">
                      {cat.cases.map((c) => (
                        <TestCaseCard 
                          key={c.id} 
                          testCase={c} 
                          actualResult={results[c.id] || "Pending"} 
                          onSelect={handleSelect} 
                        />
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TestCaseCard({
  testCase,
  actualResult,
  onSelect,
}: {
  testCase: TestCase;
  actualResult: AnalysisStatus;
  onSelect: (code: string) => void;
}) {
  const expected = testCase.expectedResult;
  const isMatch = actualResult === expected;
  const isLoading = actualResult === "Loading" || actualResult === "Pending";
  const isError = actualResult === "Error";

  return (
    <button
      onClick={() => onSelect(testCase.content)}
      className="group flex w-full flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-left transition-all hover:border-blue-300 hover:shadow-md active:scale-[0.995]"
    >
      <div className="flex w-full items-start justify-between gap-4">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <span className="font-mono text-sm font-bold text-neutral-900 group-hover:text-blue-700 break-all">
            {testCase.name}
          </span>
          {testCase.description && (
            <p className="text-xs text-neutral-500 line-clamp-2">{testCase.description}</p>
          )}
        </div>

        {/* Status Badges */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-wider uppercase">
            {/* Expected */}
            <div className="flex flex-col items-end">
              <span className="text-[9px] text-neutral-400 font-medium mb-0.5">Expect</span>
              {expected ? (
                <Badge status={expected} />
              ) : (
                <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-400">-</span>
              )}
            </div>

            {/* Arrow */}
            <ArrowRight className="h-3 w-3 text-neutral-300" />

            {/* Actual */}
            <div className="flex flex-col items-start">
              <span className="text-[9px] text-neutral-400 font-medium mb-0.5">Actual</span>
              {isLoading ? (
                <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-400 flex items-center gap-1">
                   <Loader2 className="h-3 w-3 animate-spin" /> ...
                </span>
              ) : isError ? (
                 <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">ERROR</span>
              ) : (
                <div className="relative">
                  <Badge status={actualResult as "Secure" | "SNI_Violation"} />
                  {!isMatch && expected && (
                    <span className="absolute -top-1 -right-1 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

function Badge({ status }: { status: "Secure" | "SNI_Violation" }) {
  const isSecure = status === "Secure";
  const style = badgeStyles[status] || "bg-neutral-100 text-neutral-600";
  
  return (
    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 border ${style}`}>
      {isSecure ? <CheckCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {status === "SNI_Violation" ? "VIOLATION" : status}
    </span>
  );
}
