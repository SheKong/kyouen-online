export function getOrCreateUserId(): string {
  let uid = localStorage.getItem('concyclic_user_id');
  if (!uid) {
    uid = 'u_' + Math.random().toString(36).substring(2, 11);
    localStorage.setItem('concyclic_user_id', uid);
  }
  return uid;
}

export function getOrCreateNickname(): string {
  let name = localStorage.getItem('concyclic_nickname');
  if (!name) {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    name = `玩家_${randomNum}`;
    localStorage.setItem('concyclic_nickname', name);
  }
  return name;
}

export function saveNickname(name: string) {
  localStorage.setItem('concyclic_nickname', name);
}
