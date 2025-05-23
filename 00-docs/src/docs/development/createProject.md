{%
helium.site.pageNavigation.enabled = false
%}
# Create Project

**Experimental**

@:callout(info)
Make sure you have [setup the company project](../company/intro.md).
@:@

Creating a Project is done in two steps:

1. Create the project directory and the Helper Script.
2. Run the Helper Script to create the project structure.

Here we focus on the first step.

1. We can use the same `helperCompany.scala` script, we created in the [Init Company] step.
    ```scala
    cd ~/dev-mycompany
    ./helperCompany.scala project myProject
    ```
    This creates:
    
    ```bash
    dev-mycompany
      |  projects
      |    |  myProject
      |    |    |  helper.scala
      |    |    |  PROJECT.conf
    ``` 
   
1. Make `helper.scala` executable:
```bash
cd ~/projects/myProject
chmod +x helper.scala
```

1. Open the `mycompany-myProject` directory with your IDE (I use Intellij).

1. Adjust the `PROJECT.conf` to your needs.

```
projectName: mycompany-myProject
projectVersion: 0.1.0-SNAPSHOT
subProjects: [
  // subProject1
  // subProject2
]
dependencies: [
  // example-helper
  // example-accounts
]
```

@:callout(info)
If you haven't released `company-orchescala` yet,
you need to run it at least locally (`sbt publishLocal`) 
and set the version in the `helper.scala` manually.

```scala
//> using dep mycompany::mycompany-orchescala-helper:VERSION NOT FOUND 
// replace with:
//> using dep mycompany::mycompany-orchescala-helper:0.1.0-SNAPSHOT
```

@:@

### Next Step: [Project Development]

