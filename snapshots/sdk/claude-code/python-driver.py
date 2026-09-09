"""Project the canonical Claude Session through the real Python SDK and dsh profile."""

import json
import sys

from deepseek_harness import DeepSeekHarness


def main() -> None:
    request = json.loads(sys.argv[1])
    results = []
    with DeepSeekHarness(
        _launch_args=tuple(request["launch"]),
        cwd=request["cwd"],
        provider=request["route"]["provider"],
        model=request["route"]["model"],
        request_timeout_seconds=100,
        shutdown_timeout_seconds=10,
    ) as harness:
        session = harness.start_session("fixture-root-session")
        for content in request["input"]:
            result = session.run(content)
            results.append({
                "sessionId": result.session_id,
                "finalResponse": result.final_response,
                "finishReason": result.finish_reason,
                "events": result.events,
                "notifications": [
                    {"method": value.method, "params": value.payload}
                    for value in result.notifications
                ],
            })
    print(json.dumps(results))


if __name__ == "__main__":
    main()
