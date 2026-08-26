const parameters = new URLSearchParams(window.location.search)
const message = parameters.get('message')
const logs = parameters.get('logs')
if (message) document.querySelector('#message').textContent = message
if (logs) {
  document.querySelector('#logs').textContent = logs
  document.querySelector('#log-section').hidden = false
}
