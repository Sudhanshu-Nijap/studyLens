

import { useState } from "react";
import { CheckCircle2, CircleX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { Citation, QuizQuestion } from "@/types";

type QuizCardProps = {
  question: QuizQuestion;
  onOpenCitation: (citation: Citation) => void;
};

/** Presents a source-backed multiple-choice question and local answer feedback. */
export function QuizCard({ question, onOpenCitation }: QuizCardProps) {
  const [selectedOption, setSelectedOption] = useState("");
  const [isChecked, setIsChecked] = useState(false);
  const isCorrect = selectedOption === question.correctOptionId;

  return (
    <Card className="w-full max-w-xl gap-4 border-border py-5 shadow-none">
      <CardHeader className="space-y-2 px-5">
        <Badge className="w-fit" variant="secondary">Practice question</Badge>
        <CardTitle className="text-base leading-6">{question.prompt}</CardTitle>
      </CardHeader>
      <CardContent className="px-5">
        <RadioGroup
          aria-label="Quiz answer"
          onValueChange={(value) => { setSelectedOption(value as string); setIsChecked(false); }}
          value={selectedOption}
        >
          {question.options.map((option) => (
            <Label
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2.5 font-normal hover:bg-muted"
              htmlFor={`${question.id}-${option.id}`}
              key={option.id}
            >
              <RadioGroupItem id={`${question.id}-${option.id}`} value={option.id} />
              {option.label}
            </Label>
          ))}
        </RadioGroup>
        {isChecked && (
          <div aria-live="polite" className="mt-4 rounded-lg bg-muted p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              {isCorrect ? <CheckCircle2 className="size-4" /> : <CircleX className="size-4" />}
              {isCorrect ? "Correct" : "Try reviewing the cited passage"}
            </p>
            <p className="mt-2 text-muted-foreground">{question.explanation}</p>
            <Button className="mt-2 px-0" onClick={() => onOpenCitation(question.citation)} size="sm" variant="link">
              View source
            </Button>
          </div>
        )}
      </CardContent>
      <CardFooter className="border-t border-border px-5 pt-4">
        <Button disabled={!selectedOption} onClick={() => setIsChecked(true)} size="sm">
          Check answer
        </Button>
      </CardFooter>
    </Card>
  );
}
