export const getItemAsync = async (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
export const setItemAsync = async (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } };
export const deleteItemAsync = async (k: string) => { try { localStorage.removeItem(k); } catch { /* */ } };
