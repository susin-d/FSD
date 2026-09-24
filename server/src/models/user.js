import mongoose from 'mongoose';

const userScheme = new mongoose.Schema({
    name : {
        type : String,
        required : true,
        trim : true
    },
    email : {
        type : String,
        required : true,
        trim :  true
    },
    password : {
        type : String,
        required:true
    },
    role:{
        type: String,
        enum : ['user','admin','provider'],
        default : 'user'
    },
    age : {
        type : Number
    },
    number:{
        type : Number,
        required : true
    },
    address: {
    country: {
        type: String,
        required: true,
        trim: true
    },
    state: {
        type: String,
        required: true,
        trim: true
    },
    city: {
        type: String,
        required: true,
        trim: true
    },
    street: {
        type: String,
        trim: true
    },
    pincode: {
        type: String,
        trim: true
    }
},
    isActive :{
        type : Boolean,
        default : true
    }
},{
        timestamps: true
    });

const User = mongoose.model('User',userScheme);

export default User; 