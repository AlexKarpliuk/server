const express = require('express')
const cors = require('cors')
const app = express()
const mongoose = require('mongoose')
const User = require('./models/User')
const Post = require('./models/Post')
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken')
const cookieParser = require('cookie-parser')
mongoose.set('strictQuery', true);
const multer = require('multer')
const uploadMiddleware = multer({ dest: 'uploads/' })
const fs = require('fs')
require('dotenv').config();
// const { info } = require('console')



app.use(cors({ credentials: true, origin: process.env.REACT_APP_BASE_CORS_URL }));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(__dirname + '/uploads'))


const connectDB = async () => {
	try {
		const connect = await mongoose.connect(process.env.DATABASE_URL);
		console.log(`MongoDB connected ${connect.connection.host}`)
	} catch (error) {
		console.log(error);
		process.exit(1)
	}
}

// Generate a salt to add to the hash
const salt = bcrypt.genSaltSync(10);
const secretKey = '1234567890'


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


app.get('/blog/profile', (req, res) => {
	const { token } = req.cookies;
	jwt.verify(token, secretKey, {}, (err, info) => {
		if (err) throw err;
		res.json(info);
	})
});


app.post('/blog/logout', (req, res) => {
	res.cookie('token', '').json('ok');
});


app.post('/blog/post', uploadMiddleware.single('file'), async (req, res) => {
	let newPath = null;
	if (req.file) {
		const { originalname, path } = req.file;
		const name = originalname.split('.');
		const ext = name[name.length - 1];
		newPath = path + '.' + ext;
		fs.renameSync(path, newPath);
	}

	const { token } = req.cookies;
	jwt.verify(token, secretKey, {}, async (err, info) => {
		if (err) throw err;
		const { title, summary, content } = req.body;
		const postDoc = await Post.create({
			title,
			summary,
			content,
			cover: newPath,
			author: info.id,
		});
		res.json(postDoc);
	})
});


app.put('/blog/post', uploadMiddleware.single('file'), async (req, res) => {
	let newPath = null;
	if (req.file) {
		const { originalname, path } = req.file;
		const name = originalname.split('.');
		const ext = name[name.length - 1];
		newPath = path + '.' + ext;
		fs.renameSync(path, newPath);
	}

	const { token } = req.cookies;
	jwt.verify(token, secretKey, {}, async (err, info) => {
		if (err) throw err;
		const { id, title, summary, content } = req.body;
		const postDoc = await Post.findById(id);
		const isAuthor = JSON.stringify(postDoc.author) === JSON.stringify(info.id);
		if (!isAuthor) {
			return res.status(400).json('you are not the author');
		}
		await postDoc.updateOne({
			title,
			summary,
			content,
			cover: newPath ? newPath : postDoc.cover,
		})
		res.json(postDoc);
	})
})


app.delete('/blog/edit/:id', async (req, res) => {
	const { id } = req.params;
	const post = await Post.findById(id);

	if (post.cover) {
		fs.unlink(post.cover, (err) => {
			if (err) {
				console.error(err);
				return res.status(500).send({ message: 'Error deleting cover image' });
			}
		});
	}

	await Post.findByIdAndDelete(id);
	res.status(200).json('Post deleted successfully');
});


app.get('/blog/post', async (req, res) => {
	const posts = await Post.find()
		.populate('author', ['username'])
		.sort({ createdAt: -1 })
		.limit(10)
	res.json(posts)
});


app.get('/post/:id', async (req, res) => {
	const { id } = req.params;
	const posts = await Post.findById(id)
		.populate('author', ['username']);
	res.json(posts)
});


connectDB().then(() => {
	app.listen(process.env.REACT_APP_BASE_URL, () => {
		console.log(`listening ${process.env.REACT_APP_BASE_URL}`)
	});
});