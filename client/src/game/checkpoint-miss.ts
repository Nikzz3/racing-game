/**
 * A missed gate is behind the car by more than the collection margin and less
 * than half a lap. The half-lap bound excludes gates still ahead after wrapping.
 */
export function checkpointMissed(
  carSampleIndex: number,
  owedCpSampleIndex: number,
  totalSamples: number,
  margin: number,
): boolean {
  const forwardDistance = (carSampleIndex - owedCpSampleIndex + totalSamples) % totalSamples;
  return forwardDistance > margin && forwardDistance < totalSamples / 2;
}
