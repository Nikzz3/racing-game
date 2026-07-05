/**
 * Returns true when the car has advanced more than `margin` samples past the
 * owed checkpoint without collecting it — the driver has missed that gate.
 *
 * In normal driving the owed checkpoint is always slightly ahead, so
 * howFarPast (= samples traveled forward from the owed checkpoint to the car's
 * current position, mod totalSamples) is large, close to totalSamples.  A
 * value in the range (margin, totalSamples/2) means the car has genuinely
 * driven past the gate without triggering the collection radius.  The
 * totalSamples/2 upper bound handles the start/finish wrap: when the owed
 * checkpoint is a few samples ahead (wrapping across sample 0), howFarPast
 * would be close to totalSamples — comfortably above the bound — so no false
 * positive fires.
 */
export function checkpointMissed(
  carSampleIndex: number,
  owedCpSampleIndex: number,
  totalSamples: number,
  margin: number
): boolean {
  const howFarPast = (carSampleIndex - owedCpSampleIndex + totalSamples) % totalSamples;
  return howFarPast > margin && howFarPast < totalSamples / 2;
}
