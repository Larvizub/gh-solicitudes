import { useContext } from 'react';
import { AuthContext } from './AuthContextInternal';

export function useAuth() {
  return useContext(AuthContext);
}

export default useAuth;
