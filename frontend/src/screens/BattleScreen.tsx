// frontend/src/screens/BattleScreen.tsx
import { useEffect, useState } from 'react';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { BattleHeader } from '../components/BattleHeader';
import { CountdownTimer } from '../components/CountdownTimer';
import { ScoreEntry } from '../api/types';
import { playSelectFeedback, playCorrectFeedback, playIncorrectFeedback } from '../utils/feedback';

export function BattleScreen({ gameId }: { gameId: string }) {
  const {
    question,
    questionResult,
    gameOver,
    connected,
    opponent,
    submitAnswer,
    clearGameOver,
    clearQuestionResult,
    clearQuestion,
    clearOpponent,
    reconnectGame,
  } = useGameSocketContext();
  const { replace } = useNavigation();
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [answeredIndex, setAnsweredIndex] = useState<number | null>(null);
  // Fallback scores shown until the next `question_result` event arrives.
  // Seeded from the reconnect ack so a player who drops mid-question and
  // reconnects doesn't see a blank/zeroed score bar for the rest of that
  // question just because the `question_result` event that would normally
  // populate it was missed while offline.
  const [restoredScores, setRestoredScores] = useState<ScoreEntry[]>([]);

  useEffect(() => {
    if (question && question.index !== answeredIndex) {
      setSelectedOption(null);
    }
  }, [question, answeredIndex]);

  useEffect(() => {
    if (gameOver) {
      replace({
        name: 'result',
        scores: gameOver.scores,
        winnerId: gameOver.winnerId,
        forfeited: gameOver.forfeited ?? false,
      });
      clearGameOver();
      clearQuestionResult();
    }
  }, [gameOver, replace, clearGameOver, clearQuestionResult]);

  useEffect(() => {
    if (connected) {
      reconnectGame(gameId).then((ack) => {
        if (ack.scores) setRestoredScores(ack.scores);
      });
    }
  }, [connected, gameId, reconnectGame]);

  // Without this, restoredScores only ever gets its ONE snapshot from the
  // reconnect ack above (taken once, near the very start of the match) and
  // never updates again. Every question, useGameSocket resets
  // questionResult to null the instant the NEXT `question` event arrives
  // (see its 'question' listener) - so for the entire time a question is
  // being answered (the bulk of a match's real duration), BattleHeader was
  // falling back to that stale, near-zero initial snapshot instead of the
  // actual running score, making the tug-of-war bar look permanently stuck
  // near 50/50 except for a brief flash right after each question resolves.
  // Keeping restoredScores in sync with the latest questionResult here means
  // the fallback value shown between questions is always the most recent
  // real score, not the match's starting score.
  useEffect(() => {
    if (questionResult) {
      setRestoredScores(questionResult.scores);
    }
  }, [questionResult]);

  // `GameSocketProvider` sits above `NavigationProvider`, so `question`/
  // `questionResult`/`gameOver` all persist in context across screens. The
  // `gameOver` branch above already clears itself (and `questionResult`)
  // when it fires, but if this screen unmounts any other way (e.g. the user
  // navigates away mid-match without a `game_over` ever arriving), the last
  // question/result from THIS match would otherwise still be sitting in
  // context and get picked up as stale data the next time a BattleScreen
  // mounts for a different match. Clear unconditionally on unmount -
  // clearQuestion/clearQuestionResult/clearGameOver are all idempotent, so
  // this is safe even when they've already been cleared above.
  useEffect(() => {
    return () => {
      clearQuestion();
      clearQuestionResult();
      clearGameOver();
      clearOpponent();
    };
  }, [clearQuestion, clearQuestionResult, clearGameOver, clearOpponent]);

  // Fires exactly once per question: questionResult is reset to null every
  // time a new `question` event arrives, so this effect's dependency array
  // naturally sees a fresh (non-null) questionResult only once per index.
  useEffect(() => {
    if (!questionResult || questionResult.index !== answeredIndex) return;
    if (selectedOption === questionResult.correctIndex) {
      playCorrectFeedback();
    } else {
      playIncorrectFeedback();
    }
  }, [questionResult, answeredIndex, selectedOption]);

  const handleSelect = (optionIndex: number) => {
    if (!question || selectedOption !== null) return;
    playSelectFeedback();
    setSelectedOption(optionIndex);
    setAnsweredIndex(question.index);
    submitAnswer(gameId, question.index, optionIndex);
  };

  if (!question) {
    return (
      <div className="flex min-h-full items-center justify-center p-6 text-center text-ios-secondary-label">
        Keyingi savol kutilmoqda...
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-5 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="flex flex-col gap-3">
        <BattleHeader scores={questionResult?.scores ?? restoredScores} opponent={opponent} />
        <div className="flex justify-end">
          <CountdownTimer key={question.index} timeLimitMs={question.timeLimitMs} />
        </div>
      </div>
      <p className="text-xl font-bold leading-snug text-ios-label">{question.text}</p>
      <div className="flex flex-col gap-3">
        {question.options.map((option, index) => {
          const isCorrect = questionResult?.index === question.index && questionResult.correctIndex === index;
          const isSelected = selectedOption === index;
          return (
            <button
              key={index}
              type="button"
              disabled={selectedOption !== null}
              onClick={() => handleSelect(index)}
              className={`w-full rounded-2xl py-4 text-left font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] transition-transform duration-150 active:scale-[0.98] disabled:active:scale-100 ${
                isCorrect
                  ? 'bg-ios-green text-white'
                  : isSelected
                    ? 'bg-ios-blue text-white'
                    : 'bg-ios-card text-ios-label'
              }`}
            >
              <span className="px-5">{option}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
