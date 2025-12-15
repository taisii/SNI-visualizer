"use client";

import { useEffect, useState } from "react";
import { getTestCases, type TestCase, type TestCategory } from "@/app/actions/test-cases";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "sonner";
import { BookOpen, AlertTriangle, CheckCircle, X } from "lucide-react";

type TestCaseLibraryProps = {
  onSelect: (content: string) => void;
};

export function TestCaseLibrary({ onSelect }: TestCaseLibraryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [categories, setCategories] = useState<TestCategory[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && categories.length === 0) {
      loadCases();
    }
  }, [isOpen]);

  const loadCases = async () => {
    setIsLoading(true);
    try {
      const data = await getTestCases();
      setCategories(data);
    } catch (e) {
      toast.error("テストケースの読み込みに失敗しました");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = (code: string) => {
    onSelect(code);
    setIsOpen(false);
    toast.success("テストコードを読み込みました");
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 shadow-sm border border-neutral-200 hover:bg-neutral-50 transition-colors"
      >
        <BookOpen className="h-4 w-4" />
        Golden Set
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
          <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                ゴールデンテストセット
              </h2>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-full p-1 hover:bg-neutral-100 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {isLoading ? (
                <div className="text-center py-8 text-neutral-500">Loading...</div>
              ) : (
                <Accordion type="multiple" className="w-full">
                  {categories.map((cat) => (
                    <AccordionItem key={cat.name} value={cat.name}>
                      <AccordionTrigger className="text-base font-medium">
                        <span className="capitalize">{cat.name}</span>
                        <span className="ml-2 text-xs font-normal text-neutral-500">
                          ({cat.cases.length})
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="flex flex-col gap-2 pt-2">
                          {cat.cases.map((c) => (
                            <TestCaseCard key={c.id} testCase={c} onSelect={handleSelect} />
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TestCaseCard({
  testCase,
  onSelect,
}: {
  testCase: TestCase;
  onSelect: (code: string) => void;
}) {
  const isSecure = testCase.expectedResult === "Secure";
  const isViolation = testCase.expectedResult === "SNI_Violation";

  return (
    <button
      onClick={() => onSelect(testCase.content)}
      className="flex w-full flex-col gap-1 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3 text-left transition-all hover:border-neutral-200 hover:bg-white hover:shadow-sm"
    >
      <div className="flex w-full items-center justify-between">
        <span className="font-mono text-sm font-medium text-neutral-900">
          {testCase.name}
        </span>
        {testCase.expectedResult && (
          <span
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider ${
              isSecure
                ? "bg-green-100 text-green-700"
                : isViolation
                  ? "bg-red-100 text-red-700"
                  : "bg-neutral-100 text-neutral-600"
            }`}
          >
            {isSecure ? (
              <>
                <CheckCircle className="h-3 w-3" /> SECURE
              </>
            ) : isViolation ? (
              <>
                <AlertTriangle className="h-3 w-3" /> VIOLATION
              </>
            ) : (
              testCase.expectedResult
            )}
          </span>
        )}
      </div>
      {testCase.description && (
        <p className="text-xs text-neutral-500 line-clamp-2">{testCase.description}</p>
      )}
    </button>
  );
}
