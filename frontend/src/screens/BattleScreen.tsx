// frontend/src/screens/BattleScreen.tsx
import { useEffect, useState } from 'react';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { ScoreBar } from '../components/ScoreBar';
import { CountdownTimer } from '../components/CountdownTimer';
import { ScoreEntry } from '../api/types';
import { playSelectFeedback, playCorrectFeedback, playIncorrectFeedback } from '../utils/feedback';

export function BattleScreen({ gameId }: { gameId: string }) {
  const {
    question,
    questionResult,
    gameOver,
    connected,
    submitAnswer,
    clearGameOver,
    clearQuestionResult,
    clearQuestion,
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
    };
  }, [clearQuestion, clearQuestionResult, clearGameOver]);

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
      <div className="flex items-center justify-between gap-4">
        <ScoreBar scores={questionResult?.scores ?? restoredScores} />
        <CountdownTimer key={question.index} timeLimitMs={question.timeLimitMs} />
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
