from flask import Flask, request, jsonify
from model import quote_price

app = Flask(__name__)


@app.post("/quote")
def quote():
    body = request.get_json()
    return jsonify(price=quote_price(body["from"], body["to"]))


if __name__ == "__main__":
    app.run(port=5000)
