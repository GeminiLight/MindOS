import ToolCallBlock from '@/components/ask/ToolCallBlock';
import type { ToolCallPart } from '@/lib/types';

const EXAMPLE_PROMPT = `Please implement a MindOS-native GUI bridge for @juicesharp/rpiv-ask-user-question.

Use the upstream package without forking it. If the implementation direction affects the runtime contract, ask me a structured question before changing code.`;

const waitingQuestion: ToolCallPart = {
  type: 'tool-call',
  toolCallId: 'demo-question-waiting',
  toolName: 'ask_user_question',
  state: 'running',
  input: {
    questions: [
      {
        question: 'How should MindOS integrate the upstream ask-user-question package?',
        header: 'Integration',
        options: [
          {
            label: 'Bridge (Recommended)',
            description: 'Keep the upstream package as source of truth and wrap its UI boundary in MindOS.',
            preview: `MindOS Agent
  -> ask_user_question
  -> upstream validation and response envelope
  -> MindOS Chat Panel card
  -> user answers
  -> same agent run continues`,
          },
          {
            label: 'Reimplement',
            description: 'Copy the schema and behavior into MindOS and own future compatibility locally.',
            preview: `MindOS Agent
  -> local ask_user_question clone
  -> local validation
  -> MindOS Chat Panel card
  -> higher maintenance when upstream changes`,
          },
        ],
      },
      {
        question: 'Which UI surface should own the interaction?',
        header: 'Surface',
        multiSelect: true,
        options: [
          { label: 'Chat Panel', description: 'Render inline with tool calls inside the active MindOS Agent conversation.' },
          { label: 'Modal', description: 'Interrupt the page with a blocking dialog.' },
          { label: 'Toast', description: 'Show a lightweight notification and defer the answer elsewhere.' },
        ],
      },
    ],
  },
  userQuestion: {
    runId: 'demo-run-waiting',
    status: 'waiting',
    questions: [
      {
        question: 'How should MindOS integrate the upstream ask-user-question package?',
        header: 'Integration',
        options: [
          {
            label: 'Bridge (Recommended)',
            description: 'Keep the upstream package as source of truth and wrap its UI boundary in MindOS.',
            preview: `MindOS Agent
  -> ask_user_question
  -> upstream validation and response envelope
  -> MindOS Chat Panel card
  -> user answers
  -> same agent run continues`,
          },
          {
            label: 'Reimplement',
            description: 'Copy the schema and behavior into MindOS and own future compatibility locally.',
            preview: `MindOS Agent
  -> local ask_user_question clone
  -> local validation
  -> MindOS Chat Panel card
  -> higher maintenance when upstream changes`,
          },
        ],
      },
      {
        question: 'Which UI surface should own the interaction?',
        header: 'Surface',
        multiSelect: true,
        options: [
          { label: 'Chat Panel', description: 'Render inline with tool calls inside the active MindOS Agent conversation.' },
          { label: 'Modal', description: 'Interrupt the page with a blocking dialog.' },
          { label: 'Toast', description: 'Show a lightweight notification and defer the answer elsewhere.' },
        ],
      },
    ],
  },
};

const submittedQuestion: ToolCallPart = {
  ...waitingQuestion,
  toolCallId: 'demo-question-submitted',
  state: 'done',
  userQuestion: {
    ...waitingQuestion.userQuestion!,
    runId: 'demo-run-submitted',
    status: 'submitted',
    answers: [
      {
        questionIndex: 0,
        question: 'How should MindOS integrate the upstream ask-user-question package?',
        kind: 'option',
        answer: 'Bridge (Recommended)',
        preview: `MindOS Agent
  -> ask_user_question
  -> upstream validation and response envelope
  -> MindOS Chat Panel card
  -> user answers
  -> same agent run continues`,
      },
      {
        questionIndex: 1,
        question: 'Which UI surface should own the interaction?',
        kind: 'multi',
        answer: null,
        selected: ['Chat Panel'],
      },
    ],
  },
  output: 'User has answered your questions:\n\n1. Integration: Bridge (Recommended)\n2. Surface: Chat Panel\n\nYou can now continue with the user\'s answers in mind.',
};

const cancelledQuestion: ToolCallPart = {
  ...waitingQuestion,
  toolCallId: 'demo-question-cancelled',
  state: 'error',
  userQuestion: {
    ...waitingQuestion.userQuestion!,
    runId: 'demo-run-cancelled',
    status: 'cancelled',
    reason: 'user_cancelled',
  },
  output: 'Questionnaire was cancelled by the user.',
};

export default function AskUserQuestionDemoPage() {
  return (
    <main className="box-border min-h-screen max-w-[100vw] overflow-x-hidden bg-background py-8 text-foreground">
      <div className="mx-6 box-border flex w-[calc(100vw_-_48px)] min-w-0 max-w-[calc(100vw_-_48px)] flex-col gap-6 sm:mx-auto sm:w-full lg:max-w-6xl">
        <header className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            MindOS Agent Demo
          </p>
          <h1 className="text-2xl font-semibold tracking-normal">
            Ask User Question Preview
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            This page renders the same inline tool-call surface used by the Chat Panel for structured clarification.
          </p>
        </header>

        <section className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
          <div className="min-w-0 space-y-3">
            <h2 className="text-sm font-semibold">Prompt to try</h2>
            <pre className="box-border max-w-full overflow-hidden whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/20 p-4 text-sm leading-6 text-foreground">
              {EXAMPLE_PROMPT}
            </pre>
          </div>

          <div className="min-w-0 space-y-3">
            <h2 className="text-sm font-semibold">Expected tool-call UI</h2>
            <div className="min-w-0 space-y-2">
              <ToolCallBlock part={waitingQuestion} />
              <ToolCallBlock part={submittedQuestion} />
              <ToolCallBlock part={cancelledQuestion} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
