// backend/src/progression/progressionService.ts
import { GameState } from '../game/gameState';
import { cefrWeight } from './masteryTiers';
import { addSubjectProgress } from './xpRepository';
import { recordDailyMatch } from './dailyProgressRepository';
import { recordDailyActivity } from '../users/userRepository';
import { calculateLevelStars } from '../game/levelProgress';
import { accumulateWeeklyXp } from '../league/leagueRepository';

const TRACKED_CATEGORY = 'ingliz_tili';

// Called once per finished match (see gameEngine.ts's finishGame and
// forfeitIfStillDisconnected, right after their existing
// awardMatchAchievementsForRealPlayers call). Scoped to ingliz_tili only
// (see the design spec) - other categories are a future expansion, not a
// missing feature here. Bots are skipped first thing, same guard as
// awardMatchAchievementsForRealPlayers.
//
// Per-player try/catch (rather than one try/catch around the whole loop) is
// deliberate: recordDailyActivity (added in Task 5) THROWS - it does not
// silently no-op the way awardMatchAchievementsForRealPlayers does for a
// missing user - so without catching inside the loop body, one player's
// failure would propagate out of the `for` loop's `await` and skip every
// subsequent player entirely. That would silently drop player2's XP/quest
// update whenever only player1's update fails, which is worse than the
// (already accepted, see persistMatchResult's comment) risk of losing a
// single player's progression update. Matches persistMatchResult's
// swallow-and-log discipline: a progression-tracking failure must never
// prevent finishGame/forfeitIfStillDisconnected from completing their
// cleanup (timer teardown, socket.data.gameId reset, deleteGame) for either
// player.
export async function updateProgressionForRealPlayers(game: GameState): Promise<void> {
  if (game.category !== TRACKED_CATEGORY) return;

  for (const player of game.players) {
    if (player.isBot) continue;

    try {
      const correctCount = player.answers.filter((a) => a && a.points > 0).length;
      const masteryPointsDelta = game.questions.reduce((sum, question, index) => {
        const answer = player.answers[index];
        if (!answer || answer.points <= 0) return sum;
        return sum + cefrWeight(question.cefrLevel);
      }, 0);

      await addSubjectProgress(player.userId, game.category, player.score, masteryPointsDelta);
      await accumulateWeeklyXp(player.userId, player.score);

      const starsToday = game.level != null ? calculateLevelStars(correctCount) : null;
      await recordDailyMatch(player.userId, correctCount, starsToday);

      await recordDailyActivity(player.userId);
    } catch (err) {
      console.error(
        `progressionService: updateProgressionForRealPlayers FAILED for game ${game.gameId}, user ${player.userId} ` +
          `(XP/mastery/daily-quest/streak update was NOT fully applied for this player). Continuing with the ` +
          `remaining players so one bad update can't block the rest.`,
        err
      );
    }
  }
}
