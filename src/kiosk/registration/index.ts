/**
 * The registration wizard's chunk boundary.
 *
 * KioskApp imports this module dynamically and only when somebody taps "First
 * time here?", exactly as it does with `./printing`. The reason is the budget
 * in scripts/check-kiosk-budget.mjs: a screen most families never see must not
 * be on the path to the one every family uses. Type-only imports on the other
 * side of the boundary keep the shape known without pulling the code in.
 */
export { RegistrationFlow, type RegistrationFlowProps } from './RegistrationFlow';
export { QrScreen, type QrScreenProps } from './QrScreen';
export { MAX_CHILDREN, type DraftChild } from './steps';
