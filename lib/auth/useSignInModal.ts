/**
 * SIGN-IN MODAL — Global state for the authentication modal.
 *
 * PROTECTED ACTION PATTERN:
 * For any action that requires login, use this pattern:
 *
 *   const { user } = useAuth();
 *   const { openSignIn } = useSignInModal();
 *
 *   const handleProtectedAction = () => {
 *     if (!user) {
 *       openSignIn(() => handleProtectedAction()); // retry after sign-in
 *       return;
 *     }
 *     // proceed with the action
 *   };
 *
 * The onSuccess callback fires after the user successfully authenticates,
 * so the action they originally attempted completes seamlessly.
 */

import { create } from "zustand";

interface SignInModalState {
  isOpen: boolean;
  onSuccess: (() => void) | null;
  openSignIn: (onSuccess?: () => void) => void;
  closeSignIn: () => void;
}

export const useSignInModal = create<SignInModalState>((set) => ({
  isOpen: false,
  onSuccess: null,
  openSignIn: (onSuccess) => set({ isOpen: true, onSuccess: onSuccess ?? null }),
  closeSignIn: () => set({ isOpen: false, onSuccess: null }),
}));
