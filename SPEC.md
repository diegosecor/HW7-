# Orchestra Conductor

## The Game

A rhythm game where the player becomes an orchestra conductor by moving both hands in front of a camera. It takes inspiration from following musical targets in a game like Trombone Champ, with the player's movements serving as the controls.

The PC camera detects the player's head and both hands. The head serves as a reference for measuring each hand's height. Raising and lowering their hands moves the corresponding hands of a conductor character on screen. Each hand follows its own sequence of approaching targets, so the player must coordinate the two hands independently.

The fun comes from acting like an orchestra conductor, coordinating both hands, and seeing real movements become part of the game. Friends can take turns on the same computer.

## Visual Presentation

- The setting is a concert auditorium, with a full orchestra on the stage in front of the conductor.
- The orchestra remains visible behind the gameplay. A simple illustration is enough for the first version; detailed musician animations are optional.
- Two clearly labeled, visually distinct target lanes are overlaid on the scene: one for the left hand and one for the right hand.
- Points enter from the top of the screen and fall toward their marked target positions, inspired by the falling-note presentation of Guitar Hero.
- Each point has its own target height and arrival time. A visible landing marker shows where the correct hand must be when the point arrives. Landing heights vary, so the player must raise and lower their hands rather than hold them at a single fixed line.
- The conductor's hands, hand indicators, and targets remain easy to see against the orchestra background.

## Intended Features

- Activate the camera and detect the player's head and both hands.
- Display an orchestra conductor whose hands follow the player's vertical hand movements.
- Measure hand height relative to the head so the controls do not depend only on where the player sits in the camera image.
- Allow the player to load a local MP3 file, including a file of a famous song, and use it as the music for a round.
- Generate target timing from the music's rhythm. Points fall from above toward marked positions at different heights. Each target clearly identifies which hand must follow it. The rhythm determines when targets should be reached; the game generates their height patterns without needing to identify every musical note.
- Judge accuracy by how closely the hand's height matches a point's target height at its scheduled arrival time. Difficulty controls the allowed height error: a wider acceptable zone is easier, and a narrower zone is harder.
- Show hits and misses and track a score during the round.
- Show the final results and allow the player to play again.
- Display a warning if the camera is unavailable or hand tracking is lost, so the player can adjust their position.
- Play an audience booing sound after a streak of consecutive misses.

## Optional Instrument-Based Patterns

An extended version could assign the bass part to the left hand and another identifiable musical part to the right hand, generating each hand's targets from that part's rhythm. This requires additional audio analysis and is an optional feature, not a requirement for the minimum playable version. The minimum version uses two different target patterns synchronized with the song's rhythm.

## Audio Feedback

After a configured number of consecutive misses, the audience plays a "booooo" sound. A successful hit resets the miss streak. The boo plays once per streak and remains audible even if the background music is muted. The proposed threshold is five consecutive misses; this number is still open to adjustment.

### Proposed Feedback for Individual Misses

Successful hits keep the music audible. A missed target briefly mutes the music for 0.3 seconds before restoring it. The song timeline and target movement continue during the mute so they stay synchronized. This is a proposed rule to review; the choice between muting and an out-of-tune effect has not yet been finalized.

## Acceptance Criteria

1. The player can activate the camera. If access is denied or the camera is unavailable, the game displays a clear message.
2. When the head and both hands are visible, the game identifies the left and right hands separately and displays an indicator for each.
3. Raising or lowering a hand relative to the head raises or lowers the corresponding hand of the character. Each hand can move independently.
4. The player can select a local MP3 file and start a round using that audio. The round lasts for the duration of the song. Custom song loading is part of the full intended game.
5. During the song, points fall from the top toward marked landing positions at different heights. The left and right hands have separate, clearly labeled target sequences. Target timing is generated from the loaded music's rhythm.
6. At a point's scheduled arrival time, the game compares its target height with the correct hand's height. If the hand is within the visible acceptable zone, the game records a hit and increases the score. Each target can award points only once. Otherwise, it records a miss.
7. When the song ends, the game displays the score and the number of hits and misses. The player can restart the round or choose another song.
8. If a hand is no longer detected, the game displays a warning and does not treat the tracking loss as a valid movement that earns points.
9. Increasing the difficulty narrows the acceptable height zone. A hand position outside the displayed zone is a miss, even if it would have been accepted at an easier setting.
10. The game shows a concert auditorium with the orchestra in front of the conductor. The target lanes and hand indicators remain readable over the scene.
11. Reaching the configured consecutive-miss threshold triggers an audible audience boo once for that streak. A successful hit resets the streak and allows a later streak to trigger another boo.

If the proposed audio rule is selected, a missed target must mute the audio for 0.3 seconds and then restore it without pausing the song or the targets.

## Proposed Priorities

1. **Most important:** head and hand detection, independent falling targets for both hands, a simple auditorium and orchestra scene, the conductor character, and a complete playable round with height-based accuracy and final results.
2. **Next priority:** loading different MP3 files, generating targets from each audio file, adjustable difficulty, and the audience boo after a miss streak.
3. **Optional extension:** identifying separate musical parts to assign bass-based patterns to the left hand and another part to the right hand.
4. **Cut first if time is short:** detailed musician animations, visual polish, and celebration effects. Clear controls and a working game take priority over these details.

If time runs short, preserve the complete cycle of playing a round and viewing the results before adding more visual polish. MP3 loading remains part of the full intended game, even if it is unfinished at the end of Phase 1.

## Minimum-Version Music: Decision Still Open

The intended game lets the player load their own songs. The music source for a minimum version, if custom MP3 loading is unfinished, has not yet been chosen. One proposed fallback is a short included test track. This fallback needs to be selected before the specification is finalized.
