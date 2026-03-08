function createEmptyMemory() {
  return {
    date: new Date().toISOString().split('T')[0],
    goal: '',
    status: 'none',
    nextStep: '',
    lastAskedDate: undefined
  };
}

function shouldAskToday(memory) {
  const today = new Date().toISOString().split('T')[0];
  if (!memory || !memory.lastAskedDate) return true;
  return memory.lastAskedDate !== today;
}

module.exports = {
  createEmptyMemory,
  shouldAskToday
};
