const express = require('express')
const mongoose = require('mongoose')
const User = require('./models/User')
const Post = require('./models/Post')
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken')
const cookieParser = require('cookie-parser')
const { GridFSBucket, MongoClient, ObjectId } = require('mongodb');
const { Readable } = require('stream');
const multer = require('multer')
const cors = require('cors')
require('dotenv').config();
mongoose.set('strictQuery', true);
const app = express()

app.use(cors({ 
	 origin: process.env.REACT_APP_BASE_CORS_URL,
	 credentials: true,
	 debug: true
	 }));
app.use(express.json());
app.use(cookieParser());


const connectDB = async () => {
	try {
		const connect = await mongoose.connect(process.env.DATABASE_URL);
		console.log(`MongoDB connected ${connect.connection.host}`)
	} catch (error) {
		console.log(error);
		process.exit(1)
	}
};

// Connect to the MongoDB and create the storage there
const client = new MongoClient(process.env.DATABASE_URL, { useNewUrlParser: true });
async function connect() {
	try {
		await client.connect();
		console.log('Connected to MongoDB');
	} catch (err) {
		console.error(err);
	}
}
connect();
const storage = multer.memoryStorage();
const uploadMiddleware = multer({ storage: storage });



// Generate a salt to add to the hash
const salt = bcrypt.genSaltSync(10);
const secretKey = '1234567890'

// Register account, upload info to the mongodb, create password use bcrypt
app.post('/blog/register', async (req, res) => {
	try {
		const { username, password } = req.body;
		const userDoc = await User.create({
			username,
			password: bcrypt.hashSync(password, salt)
		});
		if (userDoc) {
			res.status(200).json({ success: true });
		} else {
			res.status(400).json({ success: false });
		}
	} catch (error) {
		res.status(500).json({ error: 'An error occurred while registering user' });
	}
});

// Login, find user in mongodb, if user?, create json web token
app.post('/blog/login', async (req, res) => {
	const { username, password } = req.body;
	const userDoc = await User.findOne({ username });
	if (!userDoc) {
		return res.status(400).json('user not found');
	};
	const passOk = bcrypt.compareSync(password, userDoc.password)
	if (passOk) {
		jwt.sign({ username, id: userDoc._id }, secretKey, {}, (err, token) => {
			if (err) throw err;
			res.cookie('token', token).json({
				id: userDoc._id,
				username
			});
		})
	} else {
		res.status(400).json('wrong credentials')
	}
});

// Profile info
app.get('/blog/profile', (req, res) => {
	const { token } = req.cookies;
	jwt.verify(token, secretKey, {}, (err, info) => {
		if (err) throw err;
		res.json(info);
	})
});

// Logout, clean up the token info
app.post('/blog/logout', (req, res) => {
	res.cookie('token', '').json('ok');
});

// Upload post info from the frontend to the MongoDB
app.post('/blog/post', uploadMiddleware.single('file'), async (req, res) => {
	const { token } = req.cookies;
	jwt.verify(token, secretKey, {}, async (err, info) => {
		if (err) throw err;
		const { title, summary, content } = req.body;
		let id = '';
		if (req.file) {
			// Create a Readable stream from the uploaded file
			const readableStream = new Readable();
			readableStream.push(req.file.buffer);
			readableStream.push(null);
			// Initialize GridFSBucket and upload the file
			const db = client.db();
			const bucket = new GridFSBucket(db);
			const filename = Date.now() + '_' + req.file.originalname;
			const uploadStream = bucket.openUploadStream(filename);
			id = uploadStream.id.toString();;
			readableStream.pipe(uploadStream);
			// Upload rest info from the form (pass cover:id)
			uploadStream.on('finish', async () => {
				const postDoc = await Post.create({
					title,
					summary,
					content,
					cover: id,
					author: info.id,
				});
				res.json(postDoc);
			})
		} else {
			const postDoc = await Post.create({
				title,
				summary,
				content,
				cover: id,
				author: info.id,
			});
			res.json(postDoc);
		}
	})
});

// Update post, if file?.then delete old one, and upload new one, if !file?.then update rest info from the form
app.put('/blog/update/:id', uploadMiddleware.single('file'), async (req, res) => {
	const { token } = req.cookies;
	const postId = req.params.id;

	jwt.verify(token, secretKey, {}, async (err, info) => {
		if (err) throw err;
		const { title, summary, content } = req.body;
		const postDoc = await Post.findById(postId);
		let id = '';
		if (req.file) {
			// Delete the old file from the Bucket
			const db = client.db();
			const bucket = new GridFSBucket(db);
			if (postDoc.cover) {
				await bucket.delete(ObjectId(postDoc.cover));
			}
			const readableStream = new Readable();
			readableStream.push(req.file.buffer);
			readableStream.push(null);
			// Create a new file on the Bucket with the updated contents
			const filename = Date.now() + '_' + req.file.originalname;
			const uploadStream = bucket.openUploadStream(filename);
			id = uploadStream.id.toString();;
			readableStream.pipe(uploadStream);
			// Wait for the upload to complete and update the post
			uploadStream.on('finish', async () => {
				postDoc.title = title;
				postDoc.summary = summary;
				postDoc.content = content;
				postDoc.cover = id;
				await postDoc.save();
				res.json(postDoc);
			});
		} else {
			// If no file
			await postDoc.updateOne({
				title,
				summary,
				content,
				cover: id,
			})
			res.json(postDoc);
		}
	});
});

// Find the file (image) on DB and open downloadStream to display image use img tag.
app.get('/post/:id/cover', async (req, res) => {
	const db = client.db();
	const bucket = new GridFSBucket(db);
	const objectId = new ObjectId(req.params.id);
	const downloadStream = bucket.openDownloadStream(objectId);
	downloadStream.pipe(res);
});

// Find the post by id pass author info. In the Front (if id and author same? show edit button)
app.get('/post/:id', async (req, res) => {
	const { id } = req.params;
	const posts = await Post.findById(id)
		.populate('author', ['username']);
	res.json(posts)
});

// Set post limit, pass author info
app.get('/blog/post', async (req, res) => {
	const posts = await Post.find()
		.populate('author', ['username'])
		.sort({ createdAt: -1 })
		.limit(10)
	res.json(posts)
});

// Delete post
app.delete('/blog/delete/:id', async (req, res) => {
	const { id } = req.params;
	const postDoc = await Post.findById(id);
	// Delete the old file from the GridFSBucket
	const db = client.db();
	const bucket = new GridFSBucket(db);
	if (postDoc.cover) {
		await bucket.delete(ObjectId(postDoc.cover));
	}
	await Post.findByIdAndDelete(id);
	res.status(200).json('Post deleted successfully');
});

// App listen
connectDB().then(() => {
	app.listen(process.env.REACT_APP_BASE_URL, () => {
		console.log(`listening the ${process.env.REACT_APP_BASE_URL}`)
	});
});