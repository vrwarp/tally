/**
 * Which component this harness is photographing.
 *
 * One line, and it is deliberately its own file: the before-frames of this
 * refinement were frozen with it pointing at `PairKioskPage`, the after-frames
 * with it pointing at the screen that replaced it. Both sides of the slider were
 * therefore shot by the same harness, in the same browser, at the same two
 * viewports — which is the only way the comparison means anything.
 */
export { KioskPage as Scene } from '@/features/kiosk/KioskPage';
