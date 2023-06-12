from flask import Flask, request, jsonify
import numpy as np
from PIL import Image
import requests
from io import BytesIO
import tensorflow as tf

app = Flask(__name__)

# download model and save it locally
model_url = "https://storage.googleapis.com/cobatest/meatme_model.h5"
model_path = "/app/model.h5"
response = requests.get(model_url)
with open(model_path, "wb") as f:
    f.write(response.content)

# load pre-trained model
model = tf.keras.models.load_model(model_path)

classes = ['Half Fresh', 'Fresh', 'Not Valid Image', 'Spoiled']

@app.route('/predict', methods=['POST'])
def process_image():
    if 'image' not in request.files:
        return jsonify({'error': 'No image file provided'})

    image_file = request.files['image']

    # load image and process
    img = Image.open(image_file)
    img = img.resize((150, 150))  # resize image to match the input size of the model
    img_array = np.array(img)
    img_array = np.expand_dims(img_array, axis=0)  # add batch dimension
    img_array = img_array / 255.0  # make output between 0.0 - 1.0


    # predictions using the loaded model
    predictions = model.predict(img_array)
    predicted_class = np.argmax(predictions)

    response = {
        'category': classes[predicted_class],
        'confidence': format(float(predictions[0][predicted_class]), ".5f")
    }

    return jsonify(response)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
