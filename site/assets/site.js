(function(){
  var root=document.documentElement,key="xt-theme";
  try{var t=localStorage.getItem(key);if(t)root.setAttribute("data-theme",t);}catch(e){}
  var b=document.getElementById("theme");
  if(b)b.addEventListener("click",function(){
    var cur=root.getAttribute("data-theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");
    var next=cur==="dark"?"light":"dark";root.setAttribute("data-theme",next);
    try{localStorage.setItem(key,next);}catch(e){}
  });
  var f=document.getElementById("tocFilter");
  if(f)f.addEventListener("input",function(){
    var q=f.value.toLowerCase();
    document.querySelectorAll(".toc a").forEach(function(a){a.style.display=a.textContent.toLowerCase().indexOf(q)>=0?"":"none";});
  });
})();
