// frontend/src/screens/BattleScreen.tsx
import { useEffect, useState } from 'react';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { ScoreBar } from '../components/ScoreBar';
import { CountdownTimer } from '../components/CountdownTimer';
import { ScoreEntry } from '../api/types';

export function BattleScreen({ gameId }: { gameId: string }) {
  const {
    question,
    questionResult,
    gameOver,
    connected,
    submitAnswer,
    clearGameOver,
    clearQuestionResult,
    reconnectGame,
    clearQuestion,
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
      clearQuestion?.();
      clearQuestionResult();
      clearGameOver();
    };
  }, [clearQuestion, clearQuestionResult, clearGameOver]);

  const handleSelect = (optionIndex: number) => {
    if (!question || selectedOption !== null) return;
    setSelectedOption(optionIndex);
    setAnsweredIndex(question.index);
    submitAnswer(gameId, question.index, optionIndex);
  };

  if (!question) {
    return <div className="p-6 text-center">Keyingi savol kutilmoqda...</div>;
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <ScoreBar scores={questionResult?.scores ?? restoredScores} />
      <CountdownTimer key={question.index} timeLimitMs={question.timeLimitMs} />
      <p className="text-lg font-semibold">{question.text}</p>
      <div className="flex flex-col gap-2">
        {question.options.map((option, index) => {
          const isCorrect = questionResult?.index === question.index && questionResult.correctIndex === index;
          const isSelected = selectedOption === index;
          return (
            <button
              key={index}
              disabled={selectedOption !== null}
              onClick={() => handleSelect(index)}
              className={`rounded-lg py-3 font-medium ${
                isCorrect
                  ? 'bg-green-500 text-white'
                  : isSelected
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100'
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
